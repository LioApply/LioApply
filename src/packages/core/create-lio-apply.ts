import { JobConfigService } from '../../config/job-config.service';
import { JevService } from '../../services/jev/jev.service';
import { JobDigestFormatter } from '../../services/task-service/job-digest.formatter';
import {
  JobDeduplicationService,
  NormalizedCandidateJob,
} from '../../utils/deduplication';
import { UserProfileCriteria } from '../../utils/jev';
import { PlaywrightService, resolveProviders } from '../providers';
import {
  PipelineDeps,
  buildSystemOneRubricState,
  resolveUserProfile,
  runClassifyCandidates,
  runScrapeAndDeduplicate,
  runSearchAndClassify,
} from './pipeline';
import {
  ApprovedCandidateJobDto,
  CvOptimizationInput,
  LioApplyOptions,
  ScrapeJobsParams,
} from './types';

function applyEnvOptions(options?: LioApplyOptions) {
  if (typeof options?.profile === 'string') {
    process.env.CONFIG_PATH = options.profile;
  }
  if (options?.classifier?.provider && options.classifier.provider !== 'auto') {
    process.env.CLASSIFIER_PROVIDER = options.classifier.provider;
  }
  if (options?.classifier?.apiKey) {
    process.env.CLASSIFIER_API_KEY = options.classifier.apiKey;
  }
  if (options?.classifier?.model) {
    process.env.CLASSIFIER_MODEL = options.classifier.model;
  }
  if (options?.classifier?.baseUrl) {
    process.env.CLASSIFIER_BASE_URL = options.classifier.baseUrl;
  }
}

/**
 * Functional SDK (`@lioapply/core`): Creates a clean, composable LioApply automation instance
 * with injected providers, System-One classifier, profile config, and optional CV plugin.
 */
export function createLioApply(options?: LioApplyOptions) {
  applyEnvOptions(options);

  const configService = new JobConfigService();
  try {
    configService.loadConfig();
  } catch {
    // Allows programmatic execution without jobs.config.yaml on disk
  }

  const profileOverride =
    options?.profile && typeof options.profile === 'object'
      ? options.profile
      : undefined;

  const deps: PipelineDeps = {
    configService,
    deduplicationService: new JobDeduplicationService(),
    jevService: new JevService(configService),
    digestFormatter: new JobDigestFormatter(),
    playwrightService: new PlaywrightService(),
    defaultProviders: resolveProviders(options?.providers),
    profileOverride,
    scraperConcurrency: options?.scraperConcurrency,
  };
  deps.jevService.initializeProvider();

  return {
    cv: options?.cv,
    getProviders: () => deps.defaultProviders,
    getUserProfile: () => resolveUserProfile(configService, profileOverride),

    scrapeJobs: (params?: ScrapeJobsParams) =>
      runScrapeAndDeduplicate(deps, params),

    classifyJobs: (
      candidates: NormalizedCandidateJob[],
      override?: Partial<UserProfileCriteria>,
    ) => runClassifyCandidates(deps, candidates, override),

    searchAndClassify: (params?: ScrapeJobsParams) =>
      runSearchAndClassify(deps, params),

    buildSystemOneClassificationState: (
      candidates: NormalizedCandidateJob[],
      override?: Partial<UserProfileCriteria>,
    ) =>
      buildSystemOneRubricState(
        resolveUserProfile(configService, override || profileOverride),
        candidates,
      ),

    async optimizeCv(
      job: CvOptimizationInput | ApprovedCandidateJobDto,
    ) {
      if (!options?.cv) {
        throw new Error(
          'Nenhum plugin de currículo configurado. Passe `cv: typstCvEngine(...)` no createLioApply().',
        );
      }
      return options.cv.optimizeForJob({
        title: job.title || 'Desenvolvedor de Software',
        company: job.company,
        description:
          'description' in job && job.description
            ? job.description
            : 'previewText' in job
              ? job.previewText
              : '',
        outputPath: 'outputPath' in job ? job.outputPath : undefined,
      });
    },
  };
}

export type LioApplyInstance = ReturnType<typeof createLioApply>;
