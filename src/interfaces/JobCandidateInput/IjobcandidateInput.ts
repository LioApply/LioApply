export interface JobCandidateInput {
  title: string;
  text: string;
  company?: string;
  location?: string;
  url?: string;
}

export interface JevFitEvaluation {
  shouldApply: boolean;
  score: number;
  matchProbability: number;
  isJobOfferProbability: number;
  reason: string;
}

export interface JobIdentity {
  title: string;
  company?: string;
}

export interface NormalizedCandidateJob extends JobCandidateInput {
  company: string;
  url: string;
}
