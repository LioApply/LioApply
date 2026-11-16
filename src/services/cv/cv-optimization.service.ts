import { Injectable, Logger, Optional } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { BaseCvData, TailoredCvEvaluation } from '../../interfaces/cv/cv.interface';
import { JobHistoryRepository } from '../../repositories/job-history.repository';
import { BotService } from '../bot/bot.service';
import { ClassifierService } from '../classifier/classifier.service';
import { CvConfigService } from './cv-config.service';
import { CvLlmService } from './cv-llm.service';
import { TypstCompilerService } from './typst-compiler.service';
import { buildSafePdfFileName, TypstTemplateService } from './typst-template.service';

export interface CvOptimizationResult {
  pdfBuffer: Buffer;
  fileName: string;
  evaluation: TailoredCvEvaluation;
  tailoredCv: BaseCvData;
}

@Injectable()
export class CvOptimizationService {
  private readonly logger = new Logger(CvOptimizationService.name);

  constructor(
    private readonly cvConfigService: CvConfigService,
    @Optional() private readonly historyRepository: JobHistoryRepository,
    private readonly cvLlmService: CvLlmService,
    private readonly classifierService: ClassifierService,
    private readonly typstTemplateService: TypstTemplateService,
    private readonly typstCompilerService: TypstCompilerService,
    @Optional() private readonly botService: BotService,
  ) {}

  async optimizeForStoredJobId(
    jobId: number,
    options?: { sendWhatsapp?: boolean; recipientNumber?: string },
  ): Promise<CvOptimizationResult> {
    const storedJob = await this.historyRepository.getJobById(jobId);
    if (!storedJob) throw new Error(`Vaga [#${jobId}] não encontrada no histórico do banco de dados.`);

    let description = storedJob.description || storedJob.title;
    if (description.length < 300 && storedJob.url?.startsWith('http')) {
      const { description: enriched } = await this.fetchJobPageMetadata(storedJob.url);
      if (enriched.length > description.length) description = enriched;
    }

    return this.optimizeForJobInput(
      { id: storedJob.id, title: storedJob.title, company: storedJob.company, description, url: storedJob.url },
      options,
    );
  }

  async optimizeForCustomInput(
    rawInput: string,
    options?: { sendWhatsapp?: boolean; recipientNumber?: string },
  ): Promise<CvOptimizationResult> {
    const trimmed = rawInput.trim();
    let title = 'Desenvolvedor de Software';
    let description = trimmed;
    let url: string | undefined;

    if (/^https?:\/\/\S+$/i.test(trimmed)) {
      url = trimmed;
      const fetched = await this.fetchJobPageMetadata(url);
      if (fetched.title) title = fetched.title;
      if (fetched.description) description = fetched.description;
    } else {
      const firstLine = trimmed.split('\n')[0]?.trim();
      if (firstLine && firstLine.length < 90) title = firstLine;
    }

    return this.optimizeForJobInput({ title, description, url }, options);
  }

  async optimizeForJobInput(
    jobInfo: { id?: number; title: string; company?: string; description: string; url?: string },
    options?: { sendWhatsapp?: boolean; recipientNumber?: string },
  ): Promise<CvOptimizationResult> {
    const baseCv = this.cvConfigService.getBaseCv();
    const patch = await this.cvLlmService.generateTailoredCvPatch(baseCv, {
      title: jobInfo.title,
      company: jobInfo.company,
      description: jobInfo.description,
    });
    const evaluation = await this.classifierService.evaluateTailoredCv(baseCv, patch, jobInfo);
    const tailoredCv = this.typstTemplateService.mergeBaseWithPatch(baseCv, patch);
    const typstDoc = this.typstTemplateService.renderTypstDocument(tailoredCv, {
      title: jobInfo.title,
      company: jobInfo.company,
    });
    const pdfBuffer = await this.typstCompilerService.compileToPdfBuffer(typstDoc);
    const fileName = buildSafePdfFileName(baseCv.name, jobInfo.company || jobInfo.title);

    await this.sendWhatsappPdfIfConfigured(jobInfo, fileName, pdfBuffer, evaluation, options);
    return { pdfBuffer, fileName, evaluation, tailoredCv };
  }

  parseCvCommand(messageText: string): { type: 'jobId'; jobId: number } | { type: 'custom'; input: string } | null {
    if (!messageText) return null;
    const trimmed = messageText.trim();
    const idMatch = trimmed.match(/^(?:\/cv|cv|gerar\s+cv|otimizar\s+cv)\s+#?(\d+)\s*$/i);
    if (idMatch?.[1]) return { type: 'jobId', jobId: Number(idMatch[1]) };

    const customMatch = trimmed.match(/^\/cv\s+([\s\S]+)$/i);
    return customMatch?.[1]?.trim() ? { type: 'custom', input: customMatch[1].trim() } : null;
  }

  private async sendWhatsappPdfIfConfigured(
    jobInfo: { id?: number; title: string; company?: string; url?: string },
    fileName: string,
    pdfBuffer: Buffer,
    evaluation: TailoredCvEvaluation,
    options?: { sendWhatsapp?: boolean; recipientNumber?: string },
  ): Promise<void> {
    const targetNumber = options?.recipientNumber || process.env.WHATSAPP_NUMBER;
    const instanceName = process.env.INSTANCE_NAME;
    if (!(options?.sendWhatsapp ?? true) || !targetNumber || !instanceName) return;

    const idTag = jobInfo.id ? `[#${jobInfo.id}] ` : '';
    const companyTag = jobInfo.company ? ` (${jobInfo.company})` : '';
    const caption = [
      '📄 *Currículo Otimizado Pronto!*',
      `🎯 *Vaga:* ${idTag}${jobInfo.title}${companyTag}`,
      `📊 *${evaluation.summaryReason}*`,
      jobInfo.url?.startsWith('http') ? `🔗 *Link:* ${jobInfo.url}` : '',
    ].filter(Boolean).join('\n');

    await this.botService.sendMediaDocument({
      instanceName,
      number: targetNumber,
      fileName,
      base64Pdf: pdfBuffer.toString('base64'),
      caption,
    });
  }

  private async fetchJobPageMetadata(url: string): Promise<{ title: string; description: string }> {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return { title: '', description: '' };

      const $ = cheerio.load(await res.text());
      $('script, style, nav, footer, header, noscript, svg').remove();
      const pageTitle = $('h1').first().text().trim() || $('title').first().text().trim() || '';
      const bodyText = $('main, article, [class*="description"], body')
        .first()
        .text()
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 4000);
      return { title: pageTitle.substring(0, 120), description: bodyText };
    } catch (error) {
      this.logger.debug(`Não foi possível enriquecer descrição via HTTP (${url}): ${error}`);
      return { title: '', description: '' };
    }
  }
}
