import {
  ILocationOption,
  IProviderConfig,
} from '../../interfaces/isearch/isearch.interface';
import { ClassifierProviderConfig } from '../../services/jev/classifier-providers';
import { ApprovedJobDto } from '../../services/task-service/job-digest.formatter';
import { NormalizedCandidateJob } from '../../utils/deduplication';
import { UserProfileCriteria } from '../../utils/jev';
import { BuiltinProviderName } from '../providers';

export const LIOAPPLY_PROVIDERS = 'LIOAPPLY_PROVIDERS';
export const LIOAPPLY_INSTANCE = 'LIOAPPLY_INSTANCE';

export interface CvOptimizationInput {
  title: string;
  company?: string;
  description: string;
  outputPath?: string;
}

/**
 * Minimal plugin interface satisfied by `@lioapply/cv`'s `typstCvEngine(...)`.
 * Keeps `@lioapply/core` completely decoupled from `@lioapply/cv`.
 */
export interface CvEnginePlugin {
  optimizeForJob(jobInfo: CvOptimizationInput): Promise<{
    pdfBuffer: Buffer;
    fileName: string;
    savedFilePath?: string;
    evaluation: unknown;
    tailoredCv: unknown;
  }>;
}

export interface LioApplyOptions {
  /**
   * Providers to scrape: pass factory results (`[linkedin(), glassdoor(), remotar()]`)
   * or provider names (`['linkedin', 'glassdoor']`).
   */
  providers?: Array<BuiltinProviderName | string | IProviderConfig>;

  /**
   * Multi-provider System-One classifier configuration (or `{ provider: 'none' }`).
   */
  classifier?: Partial<ClassifierProviderConfig>;

  /**
   * Path to `jobs.config.yaml` OR inline candidate profile criteria.
   */
  profile?: string | Partial<UserProfileCriteria>;

  /**
   * Optional injected CV optimization plugin (e.g. `typstCvEngine(...)` from `@lioapply/cv`).
   */
  cv?: CvEnginePlugin;

  /**
   * Max concurrent browser tabs during scraping (default: 3).
   */
  scraperConcurrency?: number;
}

export interface ApprovedCandidateJobDto extends ApprovedJobDto {
  description?: string;
}

export interface SearchAndClassifyOutput {
  rawCount: number;
  uniqueCandidates: NormalizedCandidateJob[];
  approvedJobs: ApprovedCandidateJobDto[];
  digestText: string;
}

export interface ScrapeJobsParams {
  queries?: string[];
  locations?: ILocationOption[];
  providers?: Array<BuiltinProviderName | string | IProviderConfig>;
  existingJobs?: Array<{ title: string; company?: string }>;
}
