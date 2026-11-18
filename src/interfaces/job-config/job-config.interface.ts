import { ILocationOption } from '../isearch/isearch.interface';
import { CvOptimizationConfig } from '../cv/cv.interface';
import { UserProfileCriteria } from '../classifier/system-one.interface';
import { ClassifierProviderConfig, ProviderOverrideEntry } from '../classifier/classifier.interface';

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
