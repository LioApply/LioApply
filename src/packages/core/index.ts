export { createLioApply, type LioApplyInstance } from './create-lio-apply';
export { LioApplyCoreService } from './core.service';
export { LioApplyCoreModule } from './core.module';
export {
  LIOAPPLY_INSTANCE,
  LIOAPPLY_PROVIDERS,
  type ApprovedCandidateJobDto,
  type CvEnginePlugin,
  type CvOptimizationInput,
  type LioApplyOptions,
  type ScrapeJobsParams,
  type SearchAndClassifyOutput,
} from './types';

export { JobConfigService } from '../../config/job-config.service';
export {
  JobDeduplicationService,
  normalizeScrapedPost,
  type NormalizedCandidateJob,
} from '../../utils/deduplication';
export {
  ClassifierService,
  createClassifierService,
  type JobEvaluationResult,
} from '../../services/classifier/classifier.service';
export {
  BUILTIN_PROVIDER_DEFINITIONS,
  GenericLlmProvider,
  LlmProvider,
  ProviderRegistry,
  createLlmProvider,
  createProviders,
  type ProviderDefinition,
  type ProviderOverrideEntry,
  type ProviderProtocol,
} from '../../services/classifier/providers';
export type {
  ClassifierProvider,
  ClassifierResolution,
} from '../../interfaces/classifier/classifier.interface';
export {
  JobDigestFormatter,
  type ApprovedJobDto,
} from '../../services/task-service/job-digest.formatter';
export {
  buildCompactClassifierPayload,
  parseSystemOneJsonOutput,
  type ClassifierProviderConfig,
  type ClassifierProviderType,
} from '../../services/classifier/classifier-clients';
export {
  noul,
  JOB_FIT_QUESTIONS,
  buildJobFitEvaluationFromProbabilities,
  evaluateJobFitWithJev,
  evaluateJobsBatchWithSystemOne,
  evaluateTailoredCvWithJev,
  type NoulQuestion,
  type SystemOneClient,
  type SystemOneRequest,
  type SystemOneResponse,
  type UserProfileCriteria,
} from '../../utils/jev';
