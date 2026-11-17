import { ILocationOption } from '../isearch/isearch.interface';
import { UserProfileCriteria } from '../../utils/jev';
import { CvOptimizationConfig } from '../cv/cv.interface';
import { ClassifierProviderConfig } from '../../services/classifier/classifier-clients';
import type { ProviderOverrideEntry } from '../../services/classifier/providers';

export type { ProviderOverrideEntry as ProviderConfigEntry };

export interface AppJobConfig {
  search: {
    queries: string[];
    locations: ILocationOption[];
    providers?: string[];
  };
  profile?: Partial<UserProfileCriteria>;
  classifier?: Partial<ClassifierProviderConfig>;
  cvOptimization?: Partial<CvOptimizationConfig>;
  providers?: Record<string, ProviderOverrideEntry>;
}
