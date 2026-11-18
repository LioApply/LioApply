import { Test, TestingModule } from '@nestjs/testing';
import { TaskService } from './task-service.service';
import { WhatsappService } from '../whatsapp-service/whatsapp-service.service';
import { JobHistoryRepository } from '../../repositories/job-history.repository';
import { JobDigestFormatter } from './job-digest.formatter';
import { LIOAPPLY_INSTANCE } from '@lioapply/core';

describe('TaskService', () => {
  let service: TaskService;
  let mockBotService: { sendMessage: jest.Mock };
  let mockHistoryRepository: { getRecentJobs: jest.Mock; save: jest.Mock };
  let mockLioApply: { searchAndClassify: jest.Mock };

  beforeEach(async () => {
    process.env.INSTANCE_NAME = 'test-instance';
    process.env.WHATSAPP_NUMBER = '5511999999999';
    mockBotService = {
      sendMessage: jest.fn(),
    };

    mockHistoryRepository = {
      getRecentJobs: jest.fn().mockResolvedValue([]),
      save: jest
        .fn()
        .mockResolvedValue([{ id: 42, url: 'https://example.com/job/1' }]),
    };

    mockLioApply = {
      searchAndClassify: jest.fn().mockResolvedValue({
        rawCount: 5,
        uniqueCandidates: [],
        approvedJobs: [
          {
            title: 'Desenvolvedor Node.js Pleno',
            company: 'LioApply',
            score: 90,
            reason: 'Aprovada',
            url: 'https://example.com/job/1',
            description: 'Node.js, TypeScript, NestJS',
            previewText: 'Node.js, TypeScript, NestJS',
          },
        ],
        digestText: 'Digest',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaskService,
        JobDigestFormatter,
        { provide: WhatsappService, useValue: mockBotService },
        { provide: JobHistoryRepository, useValue: mockHistoryRepository },
        { provide: LIOAPPLY_INSTANCE, useValue: mockLioApply },
      ],
    }).compile();

    service = module.get<TaskService>(TaskService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('delegates scraping and classification to the createLioApply API, saves IDs, and sends WhatsApp digest', async () => {
    const approved = await service.runScrapeJob();

    expect(mockLioApply.searchAndClassify).toHaveBeenCalledTimes(1);
    expect(mockHistoryRepository.save).toHaveBeenCalledTimes(1);
    expect(approved[0].id).toBe(42);
    expect(mockBotService.sendMessage).toHaveBeenCalledTimes(1);
  });
});
