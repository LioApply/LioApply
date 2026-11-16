import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ChatProviderConfig, ClassifierProvider } from '../../interfaces/classifier/classifier.interface';
import { BaseCvData, CvTailoredPatchDto } from '../../interfaces/cv/cv.interface';
import { extractJsonObject } from '../../utils/jev';
import { CLASSIFIER_PROVIDER_CLASSES, CLASSIFIER_PROVIDERS } from '../classifier/providers';
import { CvConfigService } from './cv-config.service';
import { buildAtsCvOptimizationPrompt } from './prompts/cv-ats.prompt';

const AUTO_ORDER = ['groq', 'gemini', 'openrouter'];
const nonEmpty = (val: unknown, fallback?: string) => (typeof val === 'string' && val.trim() ? val.trim() : fallback);
const cleanList = (val: unknown, fallback: string[] = []) =>
  Array.isArray(val) ? val.map((d) => String(d).trim()).filter(Boolean) : fallback;

@Injectable()
export class CvLlmService {
  private readonly logger = new Logger(CvLlmService.name);
  private readonly providers: ClassifierProvider[];

  constructor(
    private readonly cvConfigService: CvConfigService,
    @Optional() @Inject(CLASSIFIER_PROVIDERS) providers?: ClassifierProvider[],
  ) {
    this.providers = providers?.length
      ? providers
      : CLASSIFIER_PROVIDER_CLASSES.map((Provider) => new Provider());
  }

  async generateTailoredCvPatch(
    baseCv: BaseCvData,
    jobInfo: { title: string; company?: string; description: string },
  ): Promise<CvTailoredPatchDto> {
    const { provider, config } = this.resolveProviderAndConfig();
    const messages = buildAtsCvOptimizationPrompt(baseCv, jobInfo);
    this.logger.log(
      `🤖 Solicitando adaptação ATS via ${config.providerLabel} (modelo: ${config.model}) para a vaga "${jobInfo.title}"...`,
    );
    const rawText = await provider.chatCompletion!(messages, config);
    return this.parseTailoredPatchJson(rawText, baseCv);
  }

  resolveLlmProvider(): ChatProviderConfig {
    return this.resolveProviderAndConfig().config;
  }

  private resolveProviderAndConfig(): { provider: ClassifierProvider; config: ChatProviderConfig } {
    const cvConfig = this.cvConfigService.getCvOptimizationConfig();
    const requested = (cvConfig.provider || 'auto').trim().toLowerCase();

    const matched = this.providers.find((p) => p.id === requested);
    if (requested !== 'auto' && (requested === 'systemone' || requested === 'none' || matched?.supportsChat === false)) {
      throw new Error(
        `Provider "${requested}" é apenas um classificador System-One e não suporta geração de currículo. Use groq, gemini, openrouter, ollama ou openai-compatible.`,
      );
    }

    const targetId = this.resolveProviderId(requested);
    const provider =
      this.providers.find((p) => p.id === targetId && p.supportsChat !== false) ||
      this.providers.find((p) => p.id === 'ollama');
    if (!provider?.resolveChatConfig || !provider.chatCompletion) {
      throw new Error(`Provider de LLM "${targetId}" não disponível.`);
    }

    const config = provider.resolveChatConfig({
      apiKey: process.env.CV_API_KEY,
      model: process.env.CV_MODEL || cvConfig.model,
      baseUrl: process.env.CV_BASE_URL || cvConfig.baseUrl,
    });
    if (requested === 'openai-compatible' || (requested === 'auto' && targetId === 'ollama' && process.env.CV_BASE_URL)) {
      config.provider = 'openai-compatible';
      config.providerLabel = 'OpenAI-Compatible';
    }
    return { provider, config };
  }

  private resolveProviderId(requested: string): string {
    if (requested !== 'auto') return requested === 'openai-compatible' ? 'ollama' : requested;
    const configured = AUTO_ORDER.find((id) => this.providers.find((p) => p.id === id)?.isConfigured());
    return configured || (process.env.CV_BASE_URL ? 'ollama' : 'openrouter');
  }

  parseTailoredPatchJson(rawText: string, base: BaseCvData): CvTailoredPatchDto {
    const p = extractJsonObject<Partial<CvTailoredPatchDto>>(
      rawText,
      'A resposta do modelo de IA não contém um objeto JSON válido',
    );
    return {
      headline: nonEmpty(p.headline, base.headline),
      summary: nonEmpty(p.summary, base.summary)!,
      experience: Array.isArray(p.experience) && p.experience.length
        ? p.experience.map((e, i) => ({
            title: e.title || base.experience[i]?.title || 'Desenvolvedor',
            company: base.experience[i]?.company || e.company || '',
            location: base.experience[i]?.location || e.location || '',
            dates: base.experience[i]?.dates || e.dates || '',
            description: cleanList(e.description, base.experience[i]?.description),
          }))
        : base.experience,
      projects: Array.isArray(p.projects) && p.projects.length
        ? p.projects.map((proj, i) => ({
            name: base.projects[i]?.name || proj.name || 'Projeto',
            techStack: proj.techStack || base.projects[i]?.techStack,
            link: base.projects[i]?.link || proj.link,
            dates: base.projects[i]?.dates || proj.dates,
            description: cleanList(proj.description, base.projects[i]?.description),
          }))
        : base.projects,
      technologies: p.technologies && typeof p.technologies === 'object' ? { ...base.technologies, ...p.technologies } : base.technologies,
      sectionTitles: p.sectionTitles && typeof p.sectionTitles === 'object' ? p.sectionTitles : base.sectionTitles,
    };
  }
}
