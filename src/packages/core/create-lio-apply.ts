import { JobConfigService } from '../../config/job-config.service';
import { createClassifierService } from '../../services/classifier/classifier.service';
import { JobDigestFormatter } from '../../services/task-service/job-digest.formatter';
import { JobDeduplicationService, NormalizedCandidateJob } from '../../utils/deduplication';
import { UserProfileCriteria } from '../../utils/jev';
import { PlaywrightService, resolveProviders } from '../providers';
import {
  buildSystemOneRubricState,
  PipelineDeps,
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
  if (typeof options?.profile === 'string') process.env.CONFIG_PATH = options.profile;
  const c = options?.classifier;
  if (c?.provider && c.provider !== 'auto') process.env.CLASSIFIER_PROVIDER = c.provider;
  if (c?.apiKey) process.env.CLASSIFIER_API_KEY = c.apiKey;
  if (c?.model) process.env.CLASSIFIER_MODEL = c.model;
  if (c?.baseUrl) process.env.CLASSIFIER_BASE_URL = c.baseUrl;
}

/** Functional SDK (`@lioapply/core`): Composable LioApply automation instance. */
export function createLioApply(options?: LioApplyOptions) {
  applyEnvOptions(options);

  const configService = new JobConfigService();
  try {
    configService.loadConfig();
  } catch {
    // Allows programmatic execution without jobs.config.yaml on disk
  }

  const profileOverride = options?.profile && typeof options.profile === 'object' ? options.profile : undefined;
  const deps: PipelineDeps = {
    configService,
    deduplicationService: new JobDeduplicationService(),
    classifierService: createClassifierService(configService),
    digestFormatter: new JobDigestFormatter(),
    playwrightService: new PlaywrightService(),
    defaultProviders: resolveProviders(options?.providers),
    profileOverride,
    scraperConcurrency: options?.scraperConcurrency,
  };

  return {
    cv: options?.cv,
    getProviders: () => deps.defaultProviders,
    getUserProfile: () => resolveUserProfile(configService, profileOverride),
    scrapeJobs: (params?: ScrapeJobsParams) => runScrapeAndDeduplicate(deps, params),
    classifyJobs: (candidates: NormalizedCandidateJob[], override?: Partial<UserProfileCriteria>) =>
      runClassifyCandidates(deps, candidates, override),
    searchAndClassify: (params?: ScrapeJobsParams) => runSearchAndClassify(deps, params),
    buildSystemOneClassificationState: (
      candidates: NormalizedCandidateJob[],
      override?: Partial<UserProfileCriteria>,
    ) => buildSystemOneRubricState(resolveUserProfile(configService, override || profileOverride), candidates),

    async optimizeCv(job: CvOptimizationInput | ApprovedCandidateJobDto) {
      if (!options?.cv) {
        throw new Error('Nenhum plugin de currículo configurado. Passe `cv: typstCvEngine(...)` no createLioApply().');
      }
      const description =
        ('description' in job && job.description) || ('previewText' in job ? job.previewText : '');
      return options.cv.optimizeForJob({
        title: job.title || 'Desenvolvedor de Software',
        company: job.company,
        description,
        outputPath: 'outputPath' in job ? job.outputPath : undefined,
      });
    },
  };
}

export type LioApplyInstance = ReturnType<typeof createLioApply>;
