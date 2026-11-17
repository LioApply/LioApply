import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ChatProviderConfig, ClassifierProvider } from '../../interfaces/classifier/classifier.interface';
import { BaseCvData, CvTailoredPatchDto } from '../../interfaces/cv/cv.interface';
import { extractJsonObject } from '../../utils/jev';
import { CLASSIFIER_PROVIDERS, createProviders } from '../classifier/providers';
import { CvConfigService } from './cv-config.service';
import { buildAtsCvOptimizationPrompt } from './prompts/cv-ats.prompt';

const AUTO_ORDER = ['groq', 'gemini', 'openrouter'];
const nonEmpty = (val: unknown, fallback?: string) => (typeof val === 'string' && val.trim() ? val.trim() : fallback);
const cleanList = (val: unknown, fallback: string[] = []) =>
  Array.isArray(val) ? val.map((d) => String(d).trim()).filter(Boolean) : fallback;
const preserveTranslatedDate = (candidate: unknown, original?: string): string => {
  const next = nonEmpty(candidate);
  if (!next) return original || '';
  if (!original) return next;
  const origYears = original.match(/\b\d{4}\b/g) || [];
  const nextYears = next.match(/\b\d{4}\b/g) || [];
  const yearsConsistent =
    origYears.length === 0 || (nextYears.length > 0 && nextYears.every((y) => origYears.includes(y)));
  return yearsConsistent ? next : original;
};

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
            title: nonEmpty(e.title, base.experience[i]?.title) || 'Developer',
            company: base.experience[i]?.company || e.company || '',
            location: nonEmpty(e.location, base.experience[i]?.location) || '',
            dates: preserveTranslatedDate(e.dates, base.experience[i]?.dates),
            description: cleanList(e.description, base.experience[i]?.description),
          }))
        : base.experience,
      projects: Array.isArray(p.projects) && p.projects.length
        ? p.projects.map((proj, i) => ({
            name: base.projects[i]?.name || proj.name || 'Project',
            techStack: nonEmpty(proj.techStack, base.projects[i]?.techStack),
            link: base.projects[i]?.link || proj.link,
            dates: preserveTranslatedDate(proj.dates, base.projects[i]?.dates) || undefined,
            description: cleanList(proj.description, base.projects[i]?.description),
          }))
        : base.projects,
      education: Array.isArray(p.education) && p.education.length
        ? p.education.map((ed, i) => ({
            institution: base.education[i]?.institution || ed.institution || '',
            degree: nonEmpty(ed.degree, base.education[i]?.degree) || '',
            location: nonEmpty(ed.location, base.education[i]?.location),
            dates: preserveTranslatedDate(ed.dates, base.education[i]?.dates),
          }))
        : base.education,
      languages: Array.isArray(p.languages) && p.languages.length
        ? p.languages.map((lang, i) => ({
            language: nonEmpty(lang.language, base.languages[i]?.language) || '',
            level: nonEmpty(lang.level, base.languages[i]?.level) || '',
            certification: nonEmpty(lang.certification, base.languages[i]?.certification),
          }))
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
