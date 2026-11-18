import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { JobConfigService } from '../../config/job-config.service';
import { ClassifierProvider, ClassifierProviderConfig, ClassifierProviderType, type JobEvaluationResult } from '../../interfaces/classifier/classifier.interface';
import { JobCandidateInput } from '../../interfaces/JobCandidateInput/IjobcandidateInput';
import { BaseCvData, CvTailoredPatchDto, TailoredCvEvaluation, type JobPostingInfo } from '../../interfaces/cv/cv.interface';
import { evaluateJobFitWithJev, evaluateJobsBatchWithSystemOne, evaluateTailoredCvWithJev } from '../../utils/jev';
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
    this.logger.log(`✅ Classificador System-One inicializado com provider: ${resolution.name}`);
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

  setClientForTesting(client: SystemOneClient, name = 'test'): void {
    this.client = client;
    this.activeProviderName = name;
  }

  private ensureClient(): SystemOneClient | null {
    if (!this.client) this.initializeProvider();
    return this.client;
  }

  async evaluateJob(job: JobCandidateInput, profile: UserProfileCriteria): Promise<JobEvaluationResult> {
    const client = this.ensureClient();
    if (!client) return unconfiguredResult();

    try {
      const { shouldApply, score, reason } = await evaluateJobFitWithJev(client, job, profile);
      return { shouldApply, score, reason };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Erro ao avaliar vaga com o classificador (${this.activeProviderName}): ${message}`);
      return unconfiguredResult(`Erro na avaliação com o classificador: ${message}`);
    }
  }

  async evaluateJobsBatch(
    jobs: JobCandidateInput[],
    profile: UserProfileCriteria,
    batchSize = 10,
  ): Promise<JobEvaluationResult[]> {
    const client = this.ensureClient();
    if (!client) return jobs.map(() => unconfiguredResult());

    const safeBatchSize = Number.isFinite(batchSize) && batchSize >= 1 ? Math.floor(batchSize) : 10;
    const results: JobEvaluationResult[] = [];
    const totalBatches = Math.ceil(jobs.length / safeBatchSize);

    for (let i = 0; i < jobs.length; i += safeBatchSize) {
      const chunk = jobs.slice(i, i + safeBatchSize);
      const batchNum = Math.floor(i / safeBatchSize) + 1;
      this.logger.log(`📤 Enviando lote ${batchNum}/${totalBatches} (${chunk.length} vagas) para ${this.activeProviderName}...`);
      try {
        const evaluations = await evaluateJobsBatchWithSystemOne(client, chunk, profile);
        if (evaluations.length !== chunk.length) {
          throw new Error(`Tamanho da resposta do lote (${evaluations.length}) difere do chunk (${chunk.length}).`);
        }
        const approvedCount = evaluations.filter((e) => e.shouldApply).length;
        const maxScore = Math.max(0, ...evaluations.map((e) => e.score));
        this.logger.log(
          `📥 Resposta de ${this.activeProviderName} (lote ${batchNum}/${totalBatches}): ${approvedCount}/${chunk.length} aprovadas (maior score: ${maxScore}%).`,
        );
        results.push(...evaluations.map(({ shouldApply, score, reason }) => ({ shouldApply, score, reason })));
      } catch (error) {
        this.logger.warn(
          `Falha no lote (${chunk.length} vagas), avaliando individualmente: ${error instanceof Error ? error.message : String(error)}`,
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
    const client = this.ensureClient();
    if (!client) {
      return { isCredible: true, credibilityProbability: 1, atsScore: 85, summaryReason: 'Currículo adaptado para ATS.' };
    }
    return evaluateTailoredCvWithJev(client, baseCv, tailoredPatch, jobInfo);
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
