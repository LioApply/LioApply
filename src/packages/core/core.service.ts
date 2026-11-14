import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { JobConfigService } from '../../config/job-config.service';
import { IProviderConfig } from '../../interfaces/isearch/isearch.interface';
import { JevService } from '../../services/jev/jev.service';
import { JobDigestFormatter } from '../../services/task-service/job-digest.formatter';
import { JobDeduplicationService } from '../../utils/deduplication';
import { PlaywrightService, resolveProviders } from '../providers';
import { runSearchAndClassify } from './pipeline';
import {
  LIOAPPLY_PROVIDERS,
  ScrapeJobsParams,
  SearchAndClassifyOutput,
} from './types';

@Injectable()
export class LioApplyCoreService {
  private readonly logger = new Logger(LioApplyCoreService.name);

  constructor(
    private readonly configService: JobConfigService,
    private readonly deduplicationService: JobDeduplicationService,
    private readonly jevService: JevService,
    private readonly digestFormatter: JobDigestFormatter,
    private readonly playwrightService: PlaywrightService,
    @Optional()
    @Inject(LIOAPPLY_PROVIDERS)
    private readonly injectedProviders?: IProviderConfig[],
  ) {}

  async searchAndClassify(
    params?: ScrapeJobsParams,
  ): Promise<SearchAndClassifyOutput> {
    const defaultProviders =
      this.injectedProviders ||
      this.configService.getProviders?.() ||
      resolveProviders();

    return runSearchAndClassify(
      {
        configService: this.configService,
        deduplicationService: this.deduplicationService,
        jevService: this.jevService,
        digestFormatter: this.digestFormatter,
        playwrightService: this.playwrightService,
        defaultProviders,
        logger: this.logger,
      },
      params,
    );
  }
}
