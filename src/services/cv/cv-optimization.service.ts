import { Injectable, Logger, Optional } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { chromium } from 'playwright';
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
    let title = 'Software Developer';
    let company: string | undefined;
    let description = trimmed;
    let url: string | undefined;

    if (/^https?:\/\/\S+$/i.test(trimmed)) {
      url = trimmed;
      const fetched = await this.fetchJobPageMetadata(url);
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
    options?: { sendWhatsapp?: boolean; recipientNumber?: string },
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

  async handleEvolutionWebhook(payload: Record<string, unknown>) {
    const eventData = (Array.isArray(payload?.data) ? payload.data[0] : payload?.data || payload) as Record<string, any>;
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
      const opts = { sendWhatsapp: true, recipientNumber: senderNumber };
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

  private async fetchJobPageMetadata(url: string): Promise<{ title: string; company?: string; description: string }> {
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
      this.logger.log(`🌐 Extraindo HTML da vaga via Playwright: ${url}`);
      browser = await chromium.launch({
        headless: true,
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
      });
      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 },
      });
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      });
      await context.route('**/*', (route) => {
        const type = route.request().resourceType();
        return ['image', 'media', 'font'].includes(type) ? route.abort() : route.continue();
      });

      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
      const html = await page.content();
      return this.extractJobMetadataFromHtml(html);
    } catch (error) {
      this.logger.warn(`⚠️ Falha ao extrair vaga via Playwright (${url}): ${error instanceof Error ? error.message : error}`);
      return { title: '', description: '' };
    } finally {
      await browser?.close().catch(() => undefined);
    }
  }

  extractJobMetadataFromHtml(html: string): { title: string; company?: string; description: string } {
    const $ = cheerio.load(html);
    const jsonLd = this.extractJobPostingJsonLd($);

    $('script, style, nav, footer, header, noscript, svg').remove();
    const pageTitle =
      jsonLd?.title ||
      $('h1').first().text().trim() ||
      $('meta[property="og:title"]').attr('content')?.trim() ||
      $('title').first().text().trim() ||
      '';

    const selectors = [
      '[class*="description__text"]',
      '[class*="job-description"]',
      '[class*="jobDescription"]',
      '[data-testid*="description"]',
      '[id*="job-description"]',
      '[id*="description"]',
      'article',
      'main',
      '[class*="description"]',
      'body',
    ];

    let bestText = jsonLd?.description || '';
    if (bestText.length < 120) {
      for (const sel of selectors) {
        const text = $(sel).first().text().replace(/\s+/g, ' ').trim();
        if (text.length >= 120) {
          bestText = text;
          break;
        }
        if (text.length > bestText.length) bestText = text;
      }
    }

    if (bestText.length < 80) {
      const metaDesc =
        $('meta[property="og:description"]').attr('content')?.trim() ||
        $('meta[name="description"]').attr('content')?.trim() ||
        '';
      if (metaDesc.length > bestText.length) bestText = metaDesc;
    }

    return {
      title: pageTitle.replace(/\s+/g, ' ').trim().substring(0, 120),
      company: jsonLd?.company,
      description: bestText.replace(/\s+/g, ' ').trim().substring(0, 6000),
    };
  }

  private extractJobPostingJsonLd($: cheerio.CheerioAPI): { title?: string; company?: string; description?: string } | null {
    const scripts = $('script[type="application/ld+json"]');
    for (let i = 0; i < scripts.length; i++) {
      try {
        const parsed = JSON.parse($(scripts[i]).html() || '');
        const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.['@graph']) ? parsed['@graph'] : [parsed];
        const posting = items.find((item: any) => item?.['@type'] === 'JobPosting');
        if (posting) {
          const rawDesc = typeof posting.description === 'string' ? cheerio.load(posting.description).text() : '';
          return {
            title: typeof posting.title === 'string' ? posting.title.trim() : undefined,
            company: typeof posting.hiringOrganization?.name === 'string' ? posting.hiringOrganization.name.trim() : undefined,
            description: rawDesc.replace(/\s+/g, ' ').trim(),
          };
        }
      } catch {
        // ignore invalid JSON-LD blocks
      }
    }
    return null;
  }
}
