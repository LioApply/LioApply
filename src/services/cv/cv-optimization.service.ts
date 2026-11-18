import { Injectable, Logger, Optional } from '@nestjs/common';
import { BaseCvData, TailoredCvEvaluation } from '../../interfaces/cv/cv.interface';
import { JobHistoryRepository } from '../../repositories/job-history.repository';
import { BotService } from '../bot/bot.service';
import { ClassifierService } from '../classifier/classifier.service';
import { CvConfigService } from './cv-config.service';
import { CvLlmService } from './cv-llm.service';
import { JobPageMetadataService } from './job-page-metadata.service';
import { detectJobLanguage } from './prompts/cv-ats.prompt';
import { TypstCompilerService } from './typst-compiler.service';
import { buildSafePdfFileName, TypstTemplateService } from './typst-template.service';

export interface CvOptimizationResult {
  pdfBuffer: Buffer;
  fileName: string;
  evaluation: TailoredCvEvaluation;
  tailoredCv: BaseCvData;
}

export interface CvSendOptions {
  sendWhatsapp?: boolean;
  recipientNumber?: string;
  instanceName?: string;
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
    private readonly jobPageMetadata: JobPageMetadataService,
  ) {}

  async optimizeForStoredJobId(jobId: number, options?: CvSendOptions): Promise<CvOptimizationResult> {
    const storedJob = await this.historyRepository.getJobById(jobId);
    if (!storedJob) throw new Error(`Vaga [#${jobId}] não encontrada no histórico do banco de dados.`);

    let description = storedJob.description || storedJob.title;
    if (description.length < 300 && storedJob.url?.startsWith('http')) {
      const { description: enriched } = await this.jobPageMetadata.fetch(storedJob.url);
      if (enriched.length > description.length) description = enriched;
    }

    return this.optimizeForJobInput(
      { id: storedJob.id, title: storedJob.title, company: storedJob.company, description, url: storedJob.url },
      options,
    );
  }

  async optimizeForCustomInput(rawInput: string, options?: CvSendOptions): Promise<CvOptimizationResult> {
    const trimmed = rawInput.trim();
    let title = 'Software Developer';
    let company: string | undefined;
    let description = trimmed;
    let url: string | undefined;

    if (/^https?:\/\/\S+$/i.test(trimmed)) {
      url = trimmed;
      const fetched = await this.jobPageMetadata.fetch(url);
      if (!fetched.description || fetched.description.length < 80) {
        throw new Error(
          `Não foi possível extrair a descrição da vaga a partir do link (${url}). O site pode exigir login ou bloquear acesso automatizado. Cole o texto da descrição da vaga diretamente após /cv.`,
        );
      }
      if (fetched.title) title = fetched.title;
      if (fetched.company) company = fetched.company;
      description = fetched.description;
      this.logger.log(`🔗 Conteúdo extraído do link (${url}): título="${title}" | ${description.length} caracteres.`);
    } else {
      const firstLine = trimmed.split('\n')[0]?.trim();
      if (firstLine && firstLine.length < 90) title = firstLine;
    }

    return this.optimizeForJobInput({ title, company, description, url }, options);
  }

  async optimizeForJobInput(
    jobInfo: { id?: number; title: string; company?: string; description: string; url?: string },
    options?: CvSendOptions,
  ): Promise<CvOptimizationResult> {
    this.logger.log(
      `📄 Enviando vaga ao LLM: título="${jobInfo.title}" | descrição=${jobInfo.description.length} chars`,
    );
    const baseCv = this.cvConfigService.getBaseCv();
    const patch = await this.cvLlmService.generateTailoredCvPatch(baseCv, {
      title: jobInfo.title,
      company: jobInfo.company,
      description: jobInfo.description,
    });
    const evaluation = await this.classifierService.evaluateTailoredCv(baseCv, patch, jobInfo);
    const targetLanguage = detectJobLanguage(`${jobInfo.title}\n${jobInfo.description}`);
    const tailoredCv = this.typstTemplateService.mergeBaseWithPatch(baseCv, patch, targetLanguage);
    const typstDoc = this.typstTemplateService.renderTypstDocument(tailoredCv, {
      title: jobInfo.title,
      company: jobInfo.company,
      language: targetLanguage,
    });
    const pdfBuffer = await this.typstCompilerService.compileToPdfBuffer(typstDoc);
    const fileName = buildSafePdfFileName(baseCv.name, jobInfo.company || jobInfo.title);

    await this.sendWhatsappPdfIfConfigured(jobInfo, fileName, pdfBuffer, evaluation, options);
    return { pdfBuffer, fileName, evaluation, tailoredCv };
  }

  async handleEvolutionWebhook(payload: Record<string, unknown>) {
    const eventData = (Array.isArray(payload?.data) ? payload.data[0] : payload?.data || payload) as Record<string, any>;
    if (eventData?.key?.fromMe === true) return { status: 'ignored', reason: 'fromMe' };

    const msg = (eventData?.message || payload?.message || {}) as Record<string, any>;
    const text = msg?.conversation || msg?.extendedTextMessage?.text || payload?.text || '';
    const command = this.parseCvCommand(String(text));
    if (!command) return { status: 'ignored' };

    const remoteJid = String(eventData?.key?.remoteJid || payload?.number || '');
    const senderNumber = remoteJid.endsWith('@s.whatsapp.net')
      ? remoteJid.split('@')[0]?.replace(/\D/g, '') || process.env.WHATSAPP_NUMBER
      : process.env.WHATSAPP_NUMBER;
    const instanceName = String(payload?.instance || process.env.INSTANCE_NAME || 'job-bot');

    this.logger.log(`📥 Comando de currículo recebido via WhatsApp: ${JSON.stringify(command)}`);
    const targetLabel = command.type === 'jobId' ? `vaga [#${command.jobId}]` : 'descrição/link enviado';
    await this.notifyWhatsApp(
      instanceName,
      senderNumber,
      `⏳ *Adaptando seu currículo para a ${targetLabel}...*\nAnalisando requisitos ATS e compilando PDF com Typst.`,
    );

    try {
      const opts: CvSendOptions = { sendWhatsapp: true, recipientNumber: senderNumber, instanceName };
      const result =
        command.type === 'jobId'
          ? await this.optimizeForStoredJobId(command.jobId, opts)
          : await this.optimizeForCustomInput(command.input, opts);
      return { status: 'completed', fileName: result.fileName, evaluation: result.evaluation };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`❌ Erro ao processar comando /cv no WhatsApp: ${errMsg}`);
      await this.notifyWhatsApp(instanceName, senderNumber, `❌ *Não foi possível gerar o currículo:*\n${errMsg}`);
      return { status: 'error', message: errMsg };
    }
  }

  parseCvCommand(messageText: string): { type: 'jobId'; jobId: number } | { type: 'custom'; input: string } | null {
    if (!messageText) return null;
    const trimmed = messageText.trim();
    const idMatch = trimmed.match(/^(?:\/cv|cv|gerar\s+cv|otimizar\s+cv)\s+#?(\d+)\s*$/i);
    if (idMatch?.[1]) return { type: 'jobId', jobId: Number(idMatch[1]) };

    const customMatch = trimmed.match(/^\/cv\s+([\s\S]+)$/i);
    return customMatch?.[1]?.trim() ? { type: 'custom', input: customMatch[1].trim() } : null;
  }

  private async notifyWhatsApp(instanceName: string, number: string | undefined, text: string) {
    if (!number || !instanceName || !this.botService) return;
    await this.botService.sendMessage({ instanceName, number, text, delay: 500 }).catch(() => undefined);
  }

  private async sendWhatsappPdfIfConfigured(
    jobInfo: { id?: number; title: string; company?: string; url?: string },
    fileName: string,
    pdfBuffer: Buffer,
    evaluation: TailoredCvEvaluation,
    options?: CvSendOptions,
  ): Promise<void> {
    const targetNumber = options?.recipientNumber || process.env.WHATSAPP_NUMBER;
    const instanceName = options?.instanceName || process.env.INSTANCE_NAME;
    if (!(options?.sendWhatsapp ?? true) || !targetNumber || !instanceName || !this.botService) return;

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
}
