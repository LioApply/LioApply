import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ChatProviderConfig, ClassifierProvider } from '../../interfaces/classifier/classifier.interface';
import { BaseCvData, CvTailoredPatchDto, type JobPostingInfo } from '../../interfaces/cv/cv.interface';
import { extractJsonObject } from '../../utils/jev';
import { CLASSIFIER_PROVIDERS, createProviders } from '../classifier/providers';
import { CvConfigService } from './cv-config.service';
import { buildAtsCvOptimizationPrompt } from './prompts/cv-ats.prompt';
import { cleanList, nonEmpty } from '../../utils/text';
import { preserveTranslatedDate } from '../../utils/cv';
import { AllProvidersExhaustedError } from '../../utils/provider-fallback';

const AUTO_ORDER = ['groq', 'gemini', 'openrouter'];
@Injectable()
export class CvLlmService {
  private readonly logger = new Logger(CvLlmService.name);
  private readonly providers: ClassifierProvider[];

  constructor(
    private readonly cvConfigService: CvConfigService,
    @Optional() @Inject(CLASSIFIER_PROVIDERS) providers?: ClassifierProvider[],
  ) {
    this.providers = providers?.length ? providers : createProviders();
  }

  async generateTailoredCvPatch(
    baseCv: BaseCvData,
    jobInfo: JobPostingInfo,
  ): Promise<CvTailoredPatchDto> {
    const chain = this.resolveProviderChain();
    const messages = buildAtsCvOptimizationPrompt(baseCv, jobInfo);
    const attempted: string[] = [];
    const errors: string[] = [];

    for (let idx = 0; idx < chain.length; idx++) {
      const { provider, config } = chain[idx];
      const label = `${config.providerLabel} (${config.model})`;
      attempted.push(label);
      try {
        this.logger.log(
          `🤖 Solicitando adaptação ATS via ${config.providerLabel} (modelo: ${config.model}) para a vaga "${jobInfo.title}"...`,
        );
        const rawText = await provider.chatCompletion!(messages, config);
        return this.parseTailoredPatchJson(rawText, baseCv);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`[${label}] ${msg}`);
        const next = chain[idx + 1];
        if (next) {
          this.logger.warn(
            `⚠️ Falha ao otimizar CV com ${label}: ${msg}. Acionando fallback para ${next.config.providerLabel} (${next.config.model})...`,
          );
        } else {
          this.logger.error(`❌ Todos os providers de otimização de CV falharam: ${errors.join(' | ')}`);
        }
      }
    }

    throw new AllProvidersExhaustedError('cv', attempted, errors);
  }

  resolveLlmProvider(): ChatProviderConfig {
    return this.resolveProviderAndConfig().config;
  }

  resolveProviderChain(): Array<{ provider: ClassifierProvider; config: ChatProviderConfig }> {
    const primary = this.resolveProviderAndConfig();
    const cvConfig = this.cvConfigService.getCvOptimizationConfig();
    const explicitList = cvConfig.fallbackProviders;

    const candidateIds: string[] = explicitList?.length
      ? explicitList.map((id) => (id.trim().toLowerCase() === 'openai-compatible' ? 'ollama' : id.trim().toLowerCase()))
      : [
          ...AUTO_ORDER,
          ...this.providers.filter((p) => p.supportsChat !== false).map((p) => p.id),
        ];

    const seen = new Set<string>([primary.provider.id]);
    const chain: Array<{ provider: ClassifierProvider; config: ChatProviderConfig }> = [primary];

    for (const candidateId of candidateIds) {
      if (!candidateId || seen.has(candidateId)) continue;
      seen.add(candidateId);

      const prov = this.providers.find((p) => p.id === candidateId && p.supportsChat !== false);
      if (!prov?.resolveChatConfig || !prov.chatCompletion) continue;
      const explicitlyRequested = Boolean(explicitList?.length);
      if (!prov.isConfigured() && !(explicitlyRequested && prov.id === 'ollama')) continue;

      try {
        const config = prov.resolveChatConfig({});
        chain.push({ provider: prov, config });
      } catch {
        // skip unconfigured fallback provider
      }
    }

    return chain;
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

  private matchBaseItem<T>(
    baseList: T[],
    getKey: (item: T) => string | undefined,
    candidateKey: string | undefined,
    index: number,
  ): T | undefined {
    const normalized = candidateKey?.trim().toLowerCase();
    if (normalized) {
      const exact = baseList.find((item) => getKey(item)?.trim().toLowerCase() === normalized);
      if (exact) return exact;
    }
    return index < baseList.length ? baseList[index] : undefined;
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
        ? p.experience.slice(0, base.experience.length).map((e, i) => {
            const matched = this.matchBaseItem(base.experience, (x) => x.company, e.company, i);
            return {
              title: nonEmpty(e.title, matched?.title) || 'Developer',
              company: matched?.company || e.company || '',
              location: nonEmpty(e.location, matched?.location) || '',
              dates: preserveTranslatedDate(e.dates, matched?.dates),
              description: cleanList(e.description, matched?.description),
            };
          })
        : base.experience,
      projects: Array.isArray(p.projects) && p.projects.length
        ? p.projects.slice(0, base.projects.length).map((proj, i) => {
            const matched = this.matchBaseItem(base.projects, (x) => x.name, proj.name, i);
            return {
              name: matched?.name || proj.name || 'Project',
              techStack: nonEmpty(proj.techStack, matched?.techStack),
              link: matched?.link || proj.link,
              dates: preserveTranslatedDate(proj.dates, matched?.dates) || undefined,
              description: cleanList(proj.description, matched?.description),
            };
          })
        : base.projects,
      education: Array.isArray(p.education) && p.education.length
        ? p.education.slice(0, base.education.length).map((ed, i) => {
            const matched = this.matchBaseItem(base.education, (x) => x.institution, ed.institution, i);
            return {
              institution: matched?.institution || ed.institution || '',
              degree: nonEmpty(ed.degree, matched?.degree) || '',
              location: nonEmpty(ed.location, matched?.location),
              dates: preserveTranslatedDate(ed.dates, matched?.dates),
            };
          })
        : base.education,
      languages: Array.isArray(p.languages) && p.languages.length
        ? p.languages.slice(0, base.languages.length).map((lang, i) => {
            const matched = this.matchBaseItem(base.languages, (x) => x.language, lang.language, i);
            return {
              language: nonEmpty(lang.language, matched?.language) || '',
              level: nonEmpty(lang.level, matched?.level) || '',
              certification: nonEmpty(lang.certification, matched?.certification),
            };
          })
        : base.languages,
      certifications: Array.isArray(p.certifications) && p.certifications.length
        ? cleanList(p.certifications, base.certifications)
        : base.certifications,
      technologies: p.technologies && typeof p.technologies === 'object' ? { ...base.technologies, ...p.technologies } : base.technologies,
      techLabels: p.techLabels && typeof p.techLabels === 'object' ? p.techLabels : base.techLabels,
      sectionTitles: p.sectionTitles && typeof p.sectionTitles === 'object' ? p.sectionTitles : base.sectionTitles,
    };
  }
}
