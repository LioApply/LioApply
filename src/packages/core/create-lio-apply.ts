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

/** Functional SDK (`@lioapply/core`): Composable LioApply automation instance. */
export function createLioApply(options?: LioApplyOptions) {
  const configPath = typeof options?.profile === 'string' ? options.profile : undefined;
  const configService = new JobConfigService();
  try {
    configService.loadConfig(configPath);
  } catch {
    // Allows programmatic execution without jobs.config.yaml on disk
  }

  const profileOverride = options?.profile && typeof options.profile === 'object' ? options.profile : undefined;
  const classifierOverride = options?.classifier
    ? {
        ...(options.classifier.provider && options.classifier.provider !== 'auto'
          ? { provider: options.classifier.provider }
          : {}),
        ...(options.classifier.apiKey ? { apiKey: options.classifier.apiKey } : {}),
        ...(options.classifier.model ? { model: options.classifier.model } : {}),
        ...(options.classifier.baseUrl ? { baseUrl: options.classifier.baseUrl } : {}),
      }
    : undefined;

  const deps: PipelineDeps = {
    configService,
    deduplicationService: new JobDeduplicationService(),
    classifierService: createClassifierService(configService, classifierOverride),
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
