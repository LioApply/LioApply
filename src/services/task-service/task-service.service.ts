import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { LIOAPPLY_INSTANCE, type LioApplyInstance } from '@lioapply/core';
import { JobHistoryRepository } from '../../repositories/job-history.repository';
import { BotService } from '../bot/bot.service';
import { ApprovedJobDto, JobDigestFormatter } from './job-digest.formatter';

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(
    private readonly botService: BotService,
    private readonly historyRepository: JobHistoryRepository,
    private readonly digestFormatter: JobDigestFormatter,
    @Optional() @Inject(LIOAPPLY_INSTANCE) private readonly lio?: LioApplyInstance,
  ) {}

  async runScrapeJob(): Promise<ApprovedJobDto[]> {
    if (!this.lio) {
      this.logger.warn('Instância LioApply (LIOAPPLY_INSTANCE) não injetada.');
      return [];
    }

    const existingJobs = await this.historyRepository.getRecentJobs(300, 30);
    const { approvedJobs } = await this.lio.searchAndClassify({ existingJobs });
    if (approvedJobs.length === 0) {
      this.logger.log('Nenhuma nova vaga aprovada passou pelos filtros nesta execução.');
      return [];
    }

    const savedRecords =
      (await this.historyRepository.save(
        approvedJobs.map((job) => ({
          url: job.url,
          title: job.title || 'Desenvolvedor',
          company: job.company,
          description: job.description || job.previewText,
        })),
      )) || [];

    const urlToId = new Map(savedRecords.filter((r) => r.url && r.id).map((r) => [r.url, r.id!]));
    for (const job of approvedJobs) {
      const dbId = urlToId.get(job.url);
      if (dbId) job.id = dbId;
    }

    await this.botService.sendMessage({
      instanceName: process.env.INSTANCE_NAME!,
      number: process.env.WHATSAPP_NUMBER!,
      text: this.digestFormatter.format(approvedJobs),
      delay: 1500,
    });
    return approvedJobs;
  }
}
