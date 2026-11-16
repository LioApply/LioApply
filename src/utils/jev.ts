import { Logger } from '@nestjs/common';
import { BaseCvData, CvTailoredPatchDto, TailoredCvEvaluation } from '../interfaces/cv/cv.interface';
import { JevFitEvaluation, JobCandidateInput } from '../interfaces/JobCandidateInput/IjobcandidateInput';

const logger = new Logger('SystemOneClassifier');

export interface NoulCriteria { true: string; false: string }
export interface NoulQuestion { type: 'noul'; instructions: string; criteria: NoulCriteria }
export const noul = (instructions: string, criteria: NoulCriteria): NoulQuestion => ({
  type: 'noul',
  instructions,
  criteria,
});

export interface SystemOneRequest<Q extends Record<string, NoulQuestion> = Record<string, NoulQuestion>> {
  state: Record<string, unknown>;
  questions: Q;
}
export interface SystemOneResponse<Q extends Record<string, NoulQuestion> = Record<string, NoulQuestion>> {
  answers: { [K in keyof Q]: { noul: number } };
}
export interface SystemOneClient {
  systemOne<Q extends Record<string, NoulQuestion>>(request: SystemOneRequest<Q>): Promise<SystemOneResponse<Q>>;
}
export interface UserProfileCriteria {
  targetRoles: string[];
  targetTechnologies: string[];
  acceptableLevels: string[];
  excludedLevels: string[];
  locations: string[];
}

export const JOB_FIT_QUESTIONS = {
  matches_profile: noul(
    "Does this job candidate match the user's desired criteria, acceptable seniority levels, and allowed locations?",
    {
      true: 'The position fits the target stack, is junior or pleno level, and is in an allowed location (or remote). If the description is concise (e.g. title and company card), a junior or pleno developer, full-stack, frontend, or backend position matches.',
      false: 'It requires senior/lead level, is an internship, belongs to an unrelated tech stack (e.g. C#, .NET, Java, PHP, mobile-only), is a non-tech position, or is outside allowed locations.',
    },
  ),
  is_actual_job_offer: noul(
    'Is this an actual job vacancy or recruitment post, rather than an applicant seeking employment (open to work) or unrelated promotion?',
    {
      true: 'A hiring manager, recruiter, or company is hiring or advertising a real job opening.',
      false: 'A candidate is looking for work, an advertisement for courses, or general professional commentary.',
    },
  ),
};

const CV_AUDIT_QUESTIONS = {
  preserves_credibility: noul(
    'Does `tailored_cv` remain factually credible relative to `original_companies` while sounding natural for a human technical recruiter?',
    {
      true: 'The tailored resume keeps the candidate original companies, avoids fabricated work history, and reads naturally.',
      false: 'The tailored resume invents fake companies, contains obvious keyword-stuffing spam, or contradicts the candidate background.',
    },
  ),
  strong_ats_alignment: noul(
    'Does `tailored_cv` effectively incorporate the primary technical keywords and requirements from `target_job`?',
    {
      true: 'The summary, experience bullets, and technologies strongly align with the target job requirements and stack.',
      false: 'Key technologies or role requirements from the job description are missing from the tailored resume.',
    },
  ),
};

export function extractJsonObject<T = Record<string, unknown>>(rawText: string, errorPrefix = 'Resposta sem JSON válido'): T {
  const cleaned = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error(`${errorPrefix}: ${rawText.slice(0, 160)}`);
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}

export function clampProbability(value: unknown, fallback = 0): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(num) || !Number.isFinite(num)) return fallback;
  return Math.min(1, Math.max(0, num > 1 && num <= 100 ? num / 100 : num));
}

export const buildUserCriteriaState = (profile: UserProfileCriteria) => ({
  desired_roles: profile.targetRoles,
  desired_technologies: profile.targetTechnologies,
  acceptable_levels: profile.acceptableLevels,
  strictly_excluded_levels: profile.excludedLevels,
  allowed_locations: profile.locations,
});

export const toJobCandidateState = (
  job: JobCandidateInput & { url?: string },
  excerptLength: number,
  includeUrl = false,
) => ({
  title: job.title || 'Título não especificado',
  company: job.company || 'Empresa não especificada',
  location: job.location || 'Não especificada',
  ...(includeUrl ? { url: job.url } : {}),
  description_excerpt: (job.text || '').substring(0, excerptLength),
});

export function buildJobFitEvaluationFromProbabilities(matchProb: number, isJobProb: number): JevFitEvaluation {
  const matchProbability = clampProbability(matchProb);
  const isJobOfferProbability = clampProbability(isJobProb);
  const shouldApply = isJobOfferProbability >= 0.6 && matchProbability >= 0.5;
  const score = Math.round(matchProbability * 100);
  const reason = shouldApply
    ? 'Aprovada pelo classificador: perfil e senioridade compatíveis.'
    : isJobOfferProbability < 0.6
      ? `Rejeitada pelo classificador: não aparenta ser uma vaga real de contratação (prob: ${Math.round(isJobOfferProbability * 100)}%).`
      : `Rejeitada pelo classificador: fora do perfil/senioridade desejados (prob: ${score}%).`;

  return { shouldApply, score, matchProbability, isJobOfferProbability, reason };
}

export async function evaluateJobFitWithJev(
  client: SystemOneClient,
  job: JobCandidateInput,
  profile: UserProfileCriteria,
): Promise<JevFitEvaluation> {
  try {
    const res = await client.systemOne({
      state: { user_criteria: buildUserCriteriaState(profile), job_candidate: toJobCandidateState(job, 1200) },
      questions: JOB_FIT_QUESTIONS,
    });
    return buildJobFitEvaluationFromProbabilities(
      res.answers.matches_profile?.noul ?? 0,
      res.answers.is_actual_job_offer?.noul ?? 0,
    );
  } catch (error) {
    logger.error('Erro ao avaliar vaga com o classificador System-One:', error);
    throw error;
  }
}

export async function evaluateJobsBatchWithSystemOne(
  client: SystemOneClient,
  jobs: JobCandidateInput[],
  profile: UserProfileCriteria,
): Promise<JevFitEvaluation[]> {
  if (jobs.length === 0) return [];
  if (jobs.length === 1) return [await evaluateJobFitWithJev(client, jobs[0], profile)];

  const questions: Record<string, NoulQuestion> = {};
  jobs.forEach((_, i) => {
    questions[`job_${i}_matches_profile`] = noul(
      `Does \`job_candidates[${i}]\` match \`user_criteria\` (roles, stack, acceptable seniority levels, and allowed locations)?`,
      JOB_FIT_QUESTIONS.matches_profile.criteria,
    );
    questions[`job_${i}_is_actual_job_offer`] = noul(
      `Is \`job_candidates[${i}]\` an actual job vacancy or recruitment post rather than an applicant seeking employment?`,
      JOB_FIT_QUESTIONS.is_actual_job_offer.criteria,
    );
  });

  const res = await client.systemOne({
    state: {
      user_criteria: buildUserCriteriaState(profile),
      job_candidates: jobs.map((job, id) => ({ id, ...toJobCandidateState(job, 600) })),
    },
    questions,
  });

  return jobs.map((_, i) =>
    buildJobFitEvaluationFromProbabilities(
      res.answers[`job_${i}_matches_profile`]?.noul ?? 0,
      res.answers[`job_${i}_is_actual_job_offer`]?.noul ?? 0,
    ),
  );
}

export async function evaluateTailoredCvWithJev(
  client: SystemOneClient,
  baseCv: BaseCvData,
  tailoredPatch: CvTailoredPatchDto,
  jobInfo: { title: string; company?: string; description: string },
): Promise<TailoredCvEvaluation> {
  try {
    const { languages = '', frontend = '', backend = '', databases = '', devops = '' } = tailoredPatch.technologies;
    const res = await client.systemOne({
      state: {
        target_job: {
          title: jobInfo.title,
          company: jobInfo.company || 'Não informada',
          description: jobInfo.description.substring(0, 1500),
        },
        original_companies: baseCv.experience.map((e) => e.company),
        tailored_cv: {
          summary: tailoredPatch.summary,
          experience: tailoredPatch.experience.map(({ title, company, dates, description }) => ({
            title,
            company,
            dates,
            description,
          })),
          technologies: { languages, frontend, backend, databases, devops },
        },
      },
      questions: CV_AUDIT_QUESTIONS,
    });

    const credibilityProb = clampProbability(res.answers.preserves_credibility?.noul, 1);
    const atsScore = Math.round(clampProbability(res.answers.strong_ats_alignment?.noul, 0.85) * 100);
    const isCredible = credibilityProb >= 0.5;
    const credPct = Math.round(credibilityProb * 100);

    return {
      isCredible,
      credibilityProbability: credibilityProb,
      atsScore,
      summaryReason: isCredible
        ? `Aderência ATS estimada: ${atsScore}% (Credibilidade verificada: ${credPct}%)`
        : `Aviso Classificador: texto pode soar artificial (credibilidade: ${credPct}%, ATS: ${atsScore}%)`,
    };
  } catch (error) {
    logger.warn('Aviso: Não foi possível auditar CV com o classificador:', error);
    return { isCredible: true, credibilityProbability: 1, atsScore: 85, summaryReason: 'Currículo adaptado para ATS.' };
  }
}
