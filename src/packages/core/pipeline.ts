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
import { JOB_FIT_QUESTIONS, UserProfileCriteria } from '../../utils/jev';
import { PlaywrightService, resolveProviders } from '../providers';
import {
  ApprovedCandidateJobDto,
  ScrapeJobsParams,
  SearchAndClassifyOutput,
} from './types';

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

export function resolveUserProfile(
  configService: JobConfigService,
  profileOverride?: Partial<UserProfileCriteria>,
): UserProfileCriteria {
  const base = configService.getUserProfile();
  return {
    targetRoles: profileOverride?.targetRoles || base.targetRoles,
    targetTechnologies:
      profileOverride?.targetTechnologies || base.targetTechnologies,
    acceptableLevels:
      profileOverride?.acceptableLevels || base.acceptableLevels,
    excludedLevels: profileOverride?.excludedLevels || base.excludedLevels,
    locations: profileOverride?.locations || base.locations,
  };
}

export async function runScrapeAndDeduplicate(
  deps: PipelineDeps,
  params?: ScrapeJobsParams,
): Promise<{
  rawCount: number;
  uniqueCandidates: NormalizedCandidateJob[];
}> {
  const queries = params?.queries || deps.configService.getQueries();
  const locations = params?.locations || deps.configService.getLocations();
  const providersToUse = params?.providers
    ? resolveProviders(params.providers)
    : deps.defaultProviders;

  deps.logger?.log(
    `🚀 [LioApplyCore] Buscando vagas em ${providersToUse.length} providers para ${queries.length} queries...`,
  );

  const rawPosts = await deps.playwrightService.scrapeProviders(
    providersToUse,
    queries,
    locations,
    deps.scraperConcurrency,
  );

  const seenKeys = deps.deduplicationService.createKeySet(
    params?.existingJobs || [],
  );
  const uniqueCandidates: NormalizedCandidateJob[] = [];

  for (const post of rawPosts) {
    const normalized = normalizeScrapedPost(post);
    if (!normalized) continue;
    if (
      deps.deduplicationService.isDuplicate(
        { title: normalized.title, company: normalized.company },
        seenKeys,
      )
    ) {
      continue;
    }
    seenKeys.add(
      deps.deduplicationService.createKey(normalized.title, normalized.company),
    );
    uniqueCandidates.push(normalized);
  }

  return {
    rawCount: rawPosts.length,
    uniqueCandidates,
  };
}

export async function runClassifyCandidates(
  deps: PipelineDeps,
  candidates: NormalizedCandidateJob[],
  profileOverride?: Partial<UserProfileCriteria>,
): Promise<ApprovedCandidateJobDto[]> {
  if (candidates.length === 0) return [];

  if (deps.classifierService.getActiveProviderName() === 'none') {
    return candidates.map((candidate) => ({
      title: candidate.title,
      company: candidate.company,
      score: 100,
      reason: 'Classificador desativado (provider=none).',
      url: candidate.url,
      description: candidate.text,
      previewText: candidate.text.substring(0, 150).replace(/\n/g, ' ').trim(),
    }));
  }

  deps.logger?.log(
    `🧠 [LioApplyCore] Classificando ${candidates.length} vagas inéditas em lote...`,
  );

  const profile = resolveUserProfile(
    deps.configService,
    profileOverride || deps.profileOverride,
  );
  const evaluations =
    typeof deps.classifierService.evaluateJobsBatch === 'function'
      ? await deps.classifierService.evaluateJobsBatch(candidates, profile)
      : await Promise.all(
          candidates.map((c) => deps.classifierService.evaluateJob(c, profile)),
        );

  const approved: ApprovedCandidateJobDto[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const ev = evaluations[i];
    if (!ev?.shouldApply) continue;

    deps.logger?.log(
      `✅ Vaga aprovada (score: ${ev.score}): ${candidate.title}${candidate.company ? ` (${candidate.company})` : ''}`,
    );
    approved.push({
      title: candidate.title,
      company: candidate.company,
      score: ev.score,
      reason: ev.reason,
      url: candidate.url,
      description: candidate.text,
      previewText: candidate.text.substring(0, 150).replace(/\n/g, ' ').trim(),
    });
  }

  return approved;
}

export async function runSearchAndClassify(
  deps: PipelineDeps,
  params?: ScrapeJobsParams,
): Promise<SearchAndClassifyOutput> {
  const { rawCount, uniqueCandidates } = await runScrapeAndDeduplicate(
    deps,
    params,
  );
  const approvedJobs = await runClassifyCandidates(deps, uniqueCandidates);
  const digestText =
    approvedJobs.length > 0 ? deps.digestFormatter.format(approvedJobs) : '';

  return {
    rawCount,
    uniqueCandidates,
    approvedJobs,
    digestText,
  };
}

export function buildSystemOneRubricState(
  profile: UserProfileCriteria,
  candidates: NormalizedCandidateJob[],
) {
  return {
    state: {
      user_criteria: {
        desired_roles: profile.targetRoles,
        desired_technologies: profile.targetTechnologies,
        acceptable_levels: profile.acceptableLevels,
        strictly_excluded_levels: profile.excludedLevels,
        allowed_locations: profile.locations,
      },
      job_candidates: candidates.map((c, idx) => ({
        id: idx,
        title: c.title,
        company: c.company,
        location: c.location || 'Não especificada',
        url: c.url,
        description_excerpt: c.text.substring(0, 600),
      })),
    },
    questions: JOB_FIT_QUESTIONS,
    thresholds: {
      is_actual_job_offer: 0.6,
      matches_profile: 0.5,
    },
  };
}
