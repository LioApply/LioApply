import type { ClassifierProviderType } from '../classifier/classifier.interface';

export interface CvContactInfo {
  email: string;
  phone?: string;
  location?: string;
  linkedin: string;
  github: string;
  website?: string;
}

export interface CvExperienceItem {
  title: string;
  company: string;
  location: string;
  dates: string;
  description: string[];
}

export interface CvProjectItem {
  name: string;
  techStack?: string;
  link?: string;
  dates?: string;
  description: string[];
}

export interface CvEducationItem {
  institution: string;
  degree: string;
  location?: string;
  dates: string;
}

export interface CvLanguageItem {
  language: string;
  level: string;
  certification?: string;
}

export interface CvTechnologies {
  languages?: string;
  frontend?: string;
  backend?: string;
  databases?: string;
  devops?: string;
  aiAndTools?: string;
  practices?: string;
}

export interface CvSectionTitles {
  summary: string;
  experience: string;
  education: string;
  languages: string;
  projects: string;
  technologies: string;
}

export interface BaseCvData {
  name: string;
  headline?: string;
  contact: CvContactInfo;
  summary: string;
  experience: CvExperienceItem[];
  projects: CvProjectItem[];
  education: CvEducationItem[];
  languages: CvLanguageItem[];
  certifications?: string[];
  technologies: CvTechnologies;
  techLabels?: Partial<Record<keyof CvTechnologies, string>>;
  sectionTitles?: Partial<CvSectionTitles>;
}

/**
 * Sections that the LLM is allowed to tailor or translate for a target job.
 * Immutable fields (name, contact, company names, institutions, years) are preserved in code.
 */
export interface CvTailoredPatchDto {
  headline?: string;
  summary: string;
  experience: CvExperienceItem[];
  projects: CvProjectItem[];
  education?: CvEducationItem[];
  languages?: CvLanguageItem[];
  certifications?: string[];
  technologies: CvTechnologies;
  techLabels?: Partial<Record<keyof CvTechnologies, string>>;
  sectionTitles?: Partial<CvSectionTitles>;
}

export interface TailoredCvEvaluation {
  isCredible: boolean;
  credibilityProbability: number;
  atsScore: number;
  summaryReason: string;
}

export type CvLlmProviderType = ClassifierProviderType;

export interface CvOptimizationConfig {
  provider?: CvLlmProviderType;
  model?: string;
  baseUrl?: string;
  baseCvPath: string;
  fallbackProviders?: CvLlmProviderType[];
}

export type SupportedCvLanguage = 'pt' | 'en' | 'es';

export interface CvOptimizationResult {
  pdfBuffer: Buffer;
  fileName: string;
  evaluation: TailoredCvEvaluation;
  tailoredCv: BaseCvData;
}

export interface CvSendOptions {
  sendWhatsapp?: boolean;
  recipientNumber?: string;
  instanceName?: string;
}

export interface JobPageMetadata {
  title: string;
  company?: string;
  description: string;
}

/** Minimal job posting data used to tailor a CV / audit it. */
export interface JobPostingInfo {
  title: string;
  company?: string;
  description: string;
}

/** Job posting data with optional stored identity, used by the CV optimization pipeline. */
export interface CvJobInput extends JobPostingInfo {
  id?: number;
  url?: string;
}
