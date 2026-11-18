import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { LIOAPPLY_INSTANCE, type LioApplyInstance } from '@lioapply/core';
import { JobHistoryRepository } from '../../repositories/job-history.repository';
import { WhatsappService } from '../whatsapp-service/whatsapp-service.service';
import { JobDigestFormatter } from './job-digest.formatter';
import { ApprovedJobDto } from '../../interfaces/job-digest/job-digest.interface';

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(
    private readonly whatsappService: WhatsappService,
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
    const { approvedJobs, classifierExhaustedMessage } = await this.lio.searchAndClassify({ existingJobs });
    if (approvedJobs.length === 0) {
      if (classifierExhaustedMessage) {
        const instanceName = process.env.INSTANCE_NAME;
        const recipientNumber = process.env.WHATSAPP_NUMBER;
        if (instanceName && recipientNumber) {
          try {
            await this.whatsappService.sendMessage({
              instanceName,
              number: recipientNumber,
              text: classifierExhaustedMessage,
              delay: 1000,
            });
          } catch (err) {
            this.logger.warn(
              `Não foi possível enviar alerta de limite de IA no WhatsApp: ${err instanceof Error ? err.message : err}`,
            );
          }
        }
      }
      this.logger.log('Nenhuma nova vaga aprovada passou pelos filtros nesta execução.');
      return [];
    }

    const instanceName = process.env.INSTANCE_NAME;
    const recipientNumber = process.env.WHATSAPP_NUMBER;
    if (!instanceName || !recipientNumber) {
      throw new Error('INSTANCE_NAME e WHATSAPP_NUMBER são obrigatórios para enviar o digest no WhatsApp.');
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

    const savedIds = savedRecords.map((r) => r.id).filter((id): id is number => typeof id === 'number');
    try {
      await this.whatsappService.sendMessage({
        instanceName,
        number: recipientNumber,
        text: this.digestFormatter.format(approvedJobs),
        delay: 1500,
      });
    } catch (error) {
      if (savedIds.length > 0 && typeof this.historyRepository.deleteByIds === 'function') {
        await this.historyRepository.deleteByIds(savedIds).catch(() => undefined);
      }
      throw error;
    }
    return approvedJobs;
  }
}
