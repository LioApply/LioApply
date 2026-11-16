import { DynamicModule, Global, Module } from '@nestjs/common';
import { JobConfigService } from '../../config/job-config.service';
import { ClassifierService } from '../../services/classifier/classifier.service';
import {
  CLASSIFIER_PROVIDER_CLASSES,
  CLASSIFIER_PROVIDERS,
} from '../../services/classifier/providers';
import { JobDigestFormatter } from '../../services/task-service/job-digest.formatter';
import { JobDeduplicationService } from '../../utils/deduplication';
import { PlaywrightService, resolveProviders } from '../providers';
import { LioApplyCoreService } from './core.service';
import { createLioApply } from './create-lio-apply';
import {
  LIOAPPLY_INSTANCE,
  LIOAPPLY_PROVIDERS,
  LioApplyOptions,
} from './types';

@Global()
@Module({})
export class LioApplyCoreModule {
  static register(options?: LioApplyOptions): DynamicModule {
    const resolved = resolveProviders(options?.providers);
    return {
      module: LioApplyCoreModule,
      providers: [
        JobConfigService,
        JobDeduplicationService,
        ...CLASSIFIER_PROVIDER_CLASSES,
        {
          provide: CLASSIFIER_PROVIDERS,
          useFactory: (...providers: unknown[]) => providers,
          inject: CLASSIFIER_PROVIDER_CLASSES,
        },
        ClassifierService,
        JobDigestFormatter,
        PlaywrightService,
        LioApplyCoreService,
        {
          provide: LIOAPPLY_PROVIDERS,
          useValue: resolved,
        },
        {
          provide: LIOAPPLY_INSTANCE,
          useFactory: () => createLioApply(options),
        },
      ],
      exports: [
        JobConfigService,
        JobDeduplicationService,
        CLASSIFIER_PROVIDERS,
        ClassifierService,
        JobDigestFormatter,
        PlaywrightService,
        LioApplyCoreService,
        LIOAPPLY_PROVIDERS,
        LIOAPPLY_INSTANCE,
      ],
    };
  }
}
