import { DynamicModule, Global, Module } from '@nestjs/common';
import { JobConfigService } from '../../config/job-config.service';
import { JevService } from '../../services/jev/jev.service';
import { JobDigestFormatter } from '../../services/task-service/job-digest.formatter';
import { JobDeduplicationService } from '../../utils/deduplication';
import { PlaywrightService, resolveProviders } from '../providers';
import { LioApplyCoreService } from './core.service';
import { LIOAPPLY_PROVIDERS, LioApplyOptions } from './types';

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
        JevService,
        JobDigestFormatter,
        PlaywrightService,
        LioApplyCoreService,
        {
          provide: LIOAPPLY_PROVIDERS,
          useValue: resolved,
        },
      ],
      exports: [
        JobConfigService,
        JobDeduplicationService,
        JevService,
        JobDigestFormatter,
        PlaywrightService,
        LioApplyCoreService,
        LIOAPPLY_PROVIDERS,
      ],
    };
  }
}
