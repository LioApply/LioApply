import { Logger } from '@nestjs/common';
import { JobConfigService } from '../../config/job-config.service';
import { IProviderConfig } from '../../interfaces/isearch/isearch.interface';
import { ClassifierService } from '../../services/classifier/classifier.service';
import { JobDigestFormatter } from '../../services/task-service/job-digest.formatter';
import {
  JobDeduplicationService,
  NormalizedCandidateJob,
  normalizeScrapedPost,
} from '../../utils/deduplication';
import {
  buildUserCriteriaState,
  JOB_FIT_QUESTIONS,
  toJobCandidateState,
  UserProfileCriteria,
} from '../../utils/jev';
import { PlaywrightService, resolveProviders } from '../providers';
import { ApprovedCandidateJobDto, ScrapeJobsParams, SearchAndClassifyOutput } from './types';

export interface PipelineDeps {
  configService: JobConfigService;
  deduplicationService: JobDeduplicationService;
  classifierService: ClassifierService;
  digestFormatter: JobDigestFormatter;
  playwrightService: PlaywrightService;
  defaultProviders: IProviderConfig[];
  profileOverride?: Partial<UserProfileCriteria>;
  scraperConcurrency?: number;
  logger?: Logger;
}

const toApprovedJob = (
  candidate: NormalizedCandidateJob,
  score: number,
  reason: string,
): ApprovedCandidateJobDto => ({
  title: candidate.title,
  company: candidate.company,
  score,
  reason,
  url: candidate.url,
  description: candidate.text,
  previewText: candidate.text.substring(0, 150).replace(/\n/g, ' ').trim(),
});

export function resolveUserProfile(
  configService: JobConfigService,
  override?: Partial<UserProfileCriteria>,
): UserProfileCriteria {
  const base = configService.getUserProfile();
  return {
    targetRoles: override?.targetRoles || base.targetRoles,
    targetTechnologies: override?.targetTechnologies || base.targetTechnologies,
    acceptableLevels: override?.acceptableLevels || base.acceptableLevels,
    excludedLevels: override?.excludedLevels || base.excludedLevels,
    locations: override?.locations || base.locations,
  };
}

export async function runScrapeAndDeduplicate(
  deps: PipelineDeps,
  params?: ScrapeJobsParams,
): Promise<{ rawCount: number; uniqueCandidates: NormalizedCandidateJob[] }> {
  const queries = params?.queries ?? deps.configService.getQueries();
  const locations = params?.locations ?? deps.configService.getLocations();
  if (!queries.length) {
    throw new Error('Nenhuma query de busca informada (passe params.queries ou configure jobs.config.yaml).');
  }
  if (!locations.length) {
    throw new Error('Nenhuma localização informada (passe params.locations ou configure jobs.config.yaml).');
  }
  const providersToUse = params?.providers ? resolveProviders(params.providers) : deps.defaultProviders;

  deps.logger?.log(
    `🚀 [LioApplyCore] Buscando vagas em ${providersToUse.length} providers para ${queries.length} queries...`,
  );

  const rawPosts = await deps.playwrightService.scrapeProviders(
    providersToUse,
    queries,
    locations,
    deps.scraperConcurrency,
  );
  const seenKeys = deps.deduplicationService.createKeySet(params?.existingJobs || []);
  const uniqueCandidates: NormalizedCandidateJob[] = [];

  for (const post of rawPosts) {
    const normalized = normalizeScrapedPost(post);
    if (!normalized) continue;
    if (deps.deduplicationService.isDuplicate({ title: normalized.title, company: normalized.company }, seenKeys)) {
      continue;
    }
    seenKeys.add(deps.deduplicationService.createKey(normalized.title, normalized.company));
    uniqueCandidates.push(normalized);
  }

  deps.logger?.log(
    `🔎 [LioApplyCore] ${rawPosts.length} vagas coletadas → ${uniqueCandidates.length} inéditas após deduplicação.`,
  );
  return { rawCount: rawPosts.length, uniqueCandidates };
}

export async function runClassifyCandidates(
  deps: PipelineDeps,
  candidates: NormalizedCandidateJob[],
  profileOverride?: Partial<UserProfileCriteria>,
): Promise<ApprovedCandidateJobDto[]> {
  if (candidates.length === 0) return [];

  const providerName = deps.classifierService.getActiveProviderName();
  if (providerName === 'none') {
    return candidates.map((c) => toApprovedJob(c, 100, 'Classificador desativado (provider=none).'));
  }

  deps.logger?.log(`🧠 [LioApplyCore] Classificando ${candidates.length} vagas inéditas via ${providerName}...`);

  const profile = resolveUserProfile(deps.configService, profileOverride || deps.profileOverride);
  const evaluations =
    typeof deps.classifierService.evaluateJobsBatch === 'function'
      ? await deps.classifierService.evaluateJobsBatch(candidates, profile)
      : await Promise.all(candidates.map((c) => deps.classifierService.evaluateJob(c, profile)));

  return candidates.flatMap((candidate, i) => {
    const ev = evaluations[i];
    if (!ev?.shouldApply) return [];
    deps.logger?.log(
      `✅ Vaga aprovada (score: ${ev.score}): ${candidate.title}${candidate.company ? ` (${candidate.company})` : ''}`,
    );
    return [toApprovedJob(candidate, ev.score, ev.reason)];
  });
}

export async function runSearchAndClassify(
  deps: PipelineDeps,
  params?: ScrapeJobsParams,
): Promise<SearchAndClassifyOutput> {
  const { rawCount, uniqueCandidates } = await runScrapeAndDeduplicate(deps, params);
  const approvedJobs = await runClassifyCandidates(deps, uniqueCandidates);
  return {
    rawCount,
    uniqueCandidates,
    approvedJobs,
    digestText: approvedJobs.length > 0 ? deps.digestFormatter.format(approvedJobs) : '',
  };
}

export function buildSystemOneRubricState(
  profile: UserProfileCriteria,
  candidates: NormalizedCandidateJob[],
) {
  return {
    state: {
      user_criteria: buildUserCriteriaState(profile),
      job_candidates: candidates.map((c, id) => ({ id, ...toJobCandidateState(c, 600, true) })),
    },
    questions: JOB_FIT_QUESTIONS,
    thresholds: { is_actual_job_offer: 0.6, matches_profile: 0.5 },
  };
}
