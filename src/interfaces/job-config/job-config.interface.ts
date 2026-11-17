import { ILocationOption } from '../isearch/isearch.interface';
import { UserProfileCriteria } from '../../utils/jev';
import { CvOptimizationConfig } from '../cv/cv.interface';
import { ClassifierProviderConfig } from '../../services/classifier/classifier-clients';

export interface ProviderConfigEntry {
  protocol?: 'openai-compatible' | 'gemini' | 'jev';
  label?: string;
  baseUrl?: string;
  model?: string;
  chatModel?: string;
  apiKeyEnv?: string;
  keyEnvs?: string[];
  urlEnvs?: string[];
  modelEnvs?: string[];
  requiresKey?: boolean;
  headers?: Record<string, string>;
  supportsChat?: boolean;
}

export interface AppJobConfig {
  search: {
    queries: string[];
    locations: ILocationOption[];
    providers?: string[];
  };
  profile?: Partial<UserProfileCriteria>;
  classifier?: Partial<ClassifierProviderConfig>;
  cvOptimization?: Partial<CvOptimizationConfig>;
  providers?: Record<string, ProviderConfigEntry>;
}
