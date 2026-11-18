import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { JobConfigService } from '../../config/job-config.service';
import {
  ClassifierProvider,
  ClassifierProviderConfig,
  ClassifierProviderType,
  ClassifierResolution,
  type JobEvaluationResult,
} from '../../interfaces/classifier/classifier.interface';
import { JobCandidateInput } from '../../interfaces/JobCandidateInput/IjobcandidateInput';
import { BaseCvData, CvTailoredPatchDto, TailoredCvEvaluation, type JobPostingInfo } from '../../interfaces/cv/cv.interface';
import { csv } from '../../utils/collections';
import { evaluateJobFitWithJev, evaluateJobsBatchWithSystemOne, evaluateTailoredCvWithJev } from '../../utils/jev';
import { AllProvidersExhaustedError } from '../../utils/provider-fallback';
import { CLASSIFIER_PROVIDERS, createProviders } from './providers';
import { SystemOneClient, UserProfileCriteria } from '../../interfaces/classifier/system-one.interface';

const AUTO_PRIORITY: ClassifierProviderType[] = ['groq', 'gemini', 'openrouter', 'jev'];
const unconfiguredResult = (reason = 'Classificador não configurado (chave ausente).'): JobEvaluationResult => ({
  shouldApply: false,
  score: 0,
  reason,
});

@Injectable()
export class ClassifierService implements OnModuleInit {
  private readonly logger = new Logger(ClassifierService.name);
  private client: SystemOneClient | null = null;
  private activeProviderName = 'none';
  private resolutions: ClassifierResolution[] = [];
  private lastExhaustedError: AllProvidersExhaustedError | null = null;

  constructor(
    @Optional() private readonly configService: JobConfigService | undefined,
    @Inject(CLASSIFIER_PROVIDERS) private readonly providers: ClassifierProvider[],
  ) {}

  onModuleInit() {
    this.initializeProvider();
  }

  initializeProvider(override?: Partial<ClassifierProviderConfig>): void {
    this.client = null;
    this.activeProviderName = 'none';
    this.resolutions = [];
    this.lastExhaustedError = null;

    const yaml = this.configService?.getClassifierConfig?.();
    const requested = (override?.provider || process.env.CLASSIFIER_PROVIDER || yaml?.provider || 'auto')
      .trim()
      .toLowerCase() as ClassifierProviderType;
    const id = this.resolveProviderId(requested, override);

    const provider = this.providers.find((p) => p.id === id);
    if (!provider) {
      this.logger.warn(
        id === 'none'
          ? 'ℹ️ Classificador System-One desativado ou sem credenciais (defina GROQ_API_KEY, GEMINI_API_KEY, OPEN_ROUTER_API_KEY ou CLASSIFIER_PROVIDER).'
          : `⚠️ Provider de classificação desconhecido: ${id}`,
      );
      return;
    }

    const resolution = provider.createClient({
      provider: id,
      apiKey: override?.apiKey || process.env.CLASSIFIER_API_KEY,
      model: override?.model || process.env.CLASSIFIER_MODEL || yaml?.model,
      baseUrl: override?.baseUrl || process.env.CLASSIFIER_BASE_URL || yaml?.baseUrl,
    });
    if (!resolution) return;

    this.client = resolution.client;
    this.activeProviderName = resolution.name;
    this.resolutions = [resolution, ...this.buildFallbackResolutions(id, yaml, override)];
    const fallbackNames = this.resolutions.slice(1).map((r) => r.name);
    const fallbackSuffix = fallbackNames.length > 0 ? ` | fallbacks: ${fallbackNames.join(' → ')}` : '';
    this.logger.log(`✅ Classificador System-One inicializado com provider: ${resolution.name}${fallbackSuffix}`);
  }

  private buildFallbackResolutions(
    primaryId: ClassifierProviderType,
    yaml?: Partial<ClassifierProviderConfig>,
    override?: Partial<ClassifierProviderConfig>,
  ): ClassifierResolution[] {
    const envFallbacks = process.env.CLASSIFIER_FALLBACK_PROVIDERS
      ? csv(process.env.CLASSIFIER_FALLBACK_PROVIDERS)
      : undefined;
    const explicitList = override?.fallbackProviders || envFallbacks || yaml?.fallbackProviders;

    const candidateIds: string[] = explicitList?.length
      ? explicitList.map((x) => (x.trim().toLowerCase() === 'systemone' ? 'jev' : x.trim().toLowerCase()))
      : [
          ...AUTO_PRIORITY,
          ...this.providers.map((p) => p.id).filter((pid) => !AUTO_PRIORITY.includes(pid)),
        ];

    const seen = new Set<string>([primaryId, 'none']);
    const fallbacks: ClassifierResolution[] = [];

    for (const candidateId of candidateIds) {
      if (!candidateId || seen.has(candidateId)) continue;
      seen.add(candidateId);

      const prov = this.providers.find((p) => p.id === candidateId);
      if (!prov) continue;
      const explicitlyRequested = Boolean(explicitList?.length);
      if (!prov.isConfigured() && !(explicitlyRequested && prov.id === 'ollama')) continue;

      const res = prov.createClient({ provider: prov.id });
      if (res) fallbacks.push(res);
    }

    return fallbacks;
  }

  private resolveProviderId(
    requested: ClassifierProviderType,
    override?: Partial<ClassifierProviderConfig>,
  ): ClassifierProviderType {
    if (requested !== 'auto') return requested === 'systemone' ? 'jev' : requested;
    const detected = AUTO_PRIORITY.find((id) => this.providers.find((p) => p.id === id)?.isConfigured());
    if (detected) return detected;
    if (override?.baseUrl || process.env.CLASSIFIER_BASE_URL) return 'ollama';
    if (override?.apiKey || process.env.CLASSIFIER_API_KEY) return 'openrouter';
    return 'none';
  }

  getActiveProviderName = (): string => this.activeProviderName;
  getFallbackProviderNames = (): string[] => this.resolutions.slice(1).map((r) => r.name);
  getLastExhaustedError = (): AllProvidersExhaustedError | null => this.lastExhaustedError;

  setClientForTesting(client: SystemOneClient, name = 'test', fallbacks: ClassifierResolution[] = []): void {
    this.client = client;
    this.activeProviderName = name;
    this.resolutions = [{ client, name }, ...fallbacks];
    this.lastExhaustedError = null;
  }

  private ensureResolutions(): ClassifierResolution[] {
    if (this.resolutions.length === 0) this.initializeProvider();
    return this.resolutions;
  }

  private async runWithFallback<T>(
    operationLabel: string,
    fn: (resolution: ClassifierResolution) => Promise<T>,
  ): Promise<T> {
    const chain = this.ensureResolutions();
    const attempted: string[] = [];
    const errors: string[] = [];

    for (let idx = 0; idx < chain.length; idx++) {
      const current = chain[idx];
      attempted.push(current.name);
      try {
        const result = await fn(current);
        if (idx > 0) {
          this.client = current.client;
          this.activeProviderName = current.name;
          this.resolutions = [current, ...chain.filter((_, i) => i !== idx)];
        }
        return result;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`[${current.name}] ${msg}`);
        const next = chain[idx + 1];
        if (next) {
          this.logger.warn(`⚠️ Falha em ${operationLabel} com ${current.name} (${msg}). Acionando fallback: ${next.name}...`);
        } else {
          this.logger.error(`❌ Todos os providers de classificação falharam em ${operationLabel}: ${errors.join(' | ')}`);
        }
      }
    }

    this.lastExhaustedError = new AllProvidersExhaustedError('classifier', attempted, errors);
    throw this.lastExhaustedError;
  }

  async evaluateJob(job: JobCandidateInput, profile: UserProfileCriteria): Promise<JobEvaluationResult> {
    const chain = this.ensureResolutions();
    if (chain.length === 0) return unconfiguredResult();

    try {
      const { shouldApply, score, reason } = await this.runWithFallback('avaliação individual', (res) =>
        evaluateJobFitWithJev(res.client, job, profile),
      );
      return { shouldApply, score, reason };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return unconfiguredResult(`Erro na avaliação com o classificador: ${message}`);
    }
  }

  async evaluateJobsBatch(
    jobs: JobCandidateInput[],
    profile: UserProfileCriteria,
    batchSize = 10,
  ): Promise<JobEvaluationResult[]> {
    const chain = this.ensureResolutions();
    if (chain.length === 0) return jobs.map(() => unconfiguredResult());
    this.lastExhaustedError = null;

    const safeBatchSize = Number.isFinite(batchSize) && batchSize >= 1 ? Math.floor(batchSize) : 10;
    const results: JobEvaluationResult[] = [];
    const totalBatches = Math.ceil(jobs.length / safeBatchSize);

    for (let i = 0; i < jobs.length; i += safeBatchSize) {
      const chunk = jobs.slice(i, i + safeBatchSize);
      const batchNum = Math.floor(i / safeBatchSize) + 1;
      try {
        const evaluations = await this.runWithFallback(`lote ${batchNum}/${totalBatches}`, async (res) => {
          this.logger.log(`📤 Enviando lote ${batchNum}/${totalBatches} (${chunk.length} vagas) para ${res.name}...`);
          const evs = await evaluateJobsBatchWithSystemOne(res.client, chunk, profile);
          if (evs.length !== chunk.length) {
            throw new Error(`Tamanho da resposta do lote (${evs.length}) difere do chunk (${chunk.length}).`);
          }
          const approvedCount = evs.filter((e) => e.shouldApply).length;
          const maxScore = Math.max(0, ...evs.map((e) => e.score));
          this.logger.log(
            `📥 Resposta de ${res.name} (lote ${batchNum}/${totalBatches}): ${approvedCount}/${chunk.length} aprovadas (maior score: ${maxScore}%).`,
          );
          return evs;
        });
        results.push(...evaluations.map(({ shouldApply, score, reason }) => ({ shouldApply, score, reason })));
      } catch (error) {
        this.logger.warn(
          `Falha no lote (${chunk.length} vagas) em todos os providers; tentando avaliação individual: ${error instanceof Error ? error.message : String(error)}`,
        );
        for (const job of chunk) results.push(await this.evaluateJob(job, profile));
      }
    }
    return results;
  }

  async evaluateTailoredCv(
    baseCv: BaseCvData,
    tailoredPatch: CvTailoredPatchDto,
    jobInfo: JobPostingInfo,
  ): Promise<TailoredCvEvaluation> {
    const chain = this.ensureResolutions();
    if (chain.length === 0) {
      return { isCredible: true, credibilityProbability: 1, atsScore: 85, summaryReason: 'Currículo adaptado para ATS.' };
    }
    for (let idx = 0; idx < chain.length; idx++) {
      const res = await evaluateTailoredCvWithJev(chain[idx].client, baseCv, tailoredPatch, jobInfo);
      if (res.atsScore > 0 || res.isCredible || idx === chain.length - 1) return res;
      this.logger.warn(`⚠️ Falha ao auditar CV com ${chain[idx].name}. Tentando fallback: ${chain[idx + 1].name}...`);
    }
    return evaluateTailoredCvWithJev(chain[0].client, baseCv, tailoredPatch, jobInfo);
  }
}

export function createClassifierService(
  configService?: JobConfigService,
  override?: Partial<ClassifierProviderConfig>,
): ClassifierService {
  const providers = createProviders(configService?.getConfig?.()?.providers);
  const service = new ClassifierService(configService, providers);
  service.initializeProvider(override);
  return service;
}
