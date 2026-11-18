import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CvOptimizationService } from './services/cv/cv-optimization.service';
import { WhatsappService } from './services/whatsapp-service/whatsapp-service.service';
import type { CreateInstanceDto } from './interfaces/ICreateInstanceDTO/icreateinstancedto.interface';
import type { SendMessageDTO } from './interfaces/SendMessageDTO';

describe('AppController', () => {
  let appController: AppController;
  let appService: jest.Mocked<AppService>;
  let whatsappService: jest.Mocked<WhatsappService>;
  let cvOptimizationService: jest.Mocked<CvOptimizationService>;

  beforeEach(async () => {
    const mockAppService = {
      getHello: jest.fn().mockReturnValue('Hello World!'),
    };

    const mockWhatsappService = {
      createInstance: jest.fn(),
      connectInstance: jest.fn(),
      sendMessage: jest.fn(),
    };

    const mockCvOptimizationService = {
      handleEvolutionWebhook: jest.fn(),
    };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        { provide: AppService, useValue: mockAppService },
        { provide: WhatsappService, useValue: mockWhatsappService },
        { provide: CvOptimizationService, useValue: mockCvOptimizationService },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
    appService = app.get(AppService);
    whatsappService = app.get(WhatsappService);
    cvOptimizationService = app.get(CvOptimizationService);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
      expect(appService.getHello).toHaveBeenCalled();
    });
  });

  describe('createInstance', () => {
    it('should create a WhatsApp instance', async () => {
      const data: CreateInstanceDto = { instanceName: 'test-instance' };
      whatsappService.createInstance.mockResolvedValue({ success: true });

      const result = await appController.create(data);

      expect(whatsappService.createInstance).toHaveBeenCalledWith(data);
      expect(result).toEqual({ success: true });
    });
  });

  describe('connectInstance', () => {
    it('should connect a WhatsApp instance', async () => {
      const instanceName = 'test-instance';
      whatsappService.connectInstance.mockResolvedValue({
        base64: 'qr-code-data',
      });

      const result = await appController.connect(instanceName);

      expect(whatsappService.connectInstance).toHaveBeenCalledWith(
        instanceName,
      );
      expect(result).toEqual({ base64: 'qr-code-data' });
    });
  });

  describe('sendMessage', () => {
    it('should send a WhatsApp message', async () => {
      const data: SendMessageDTO = {
        number: '5511999999999',
        text: 'Hello from test',
        instanceName: 'test-instance',
        delay: 1000,
      };
      whatsappService.sendMessage.mockResolvedValue({ message: 'Sent' });

      const result = await appController.sendMessage('test-instance', data);

      expect(whatsappService.sendMessage).toHaveBeenCalledWith(data);
      expect(result).toEqual({ message: 'Sent' });
    });

    it('should fallback to route :instanceName when omitted from body', async () => {
      const data = { number: '5511999999999', text: 'Hello' } as SendMessageDTO;
      whatsappService.sendMessage.mockResolvedValue({ message: 'Sent' });

      await appController.sendMessage('route-instance', data);

      expect(whatsappService.sendMessage).toHaveBeenCalledWith({
        ...data,
        instanceName: 'route-instance',
      });
    });
  });

  describe('handleEvolutionWebhook', () => {
    it('should delegate webhook payload to CvOptimizationService', async () => {
      const payload = { text: '/cv 1' };
      cvOptimizationService.handleEvolutionWebhook.mockResolvedValue({ status: 'completed' } as never);

      const result = await appController.handleEvolutionWebhook(payload);

      expect(cvOptimizationService.handleEvolutionWebhook).toHaveBeenCalledWith(payload);
      expect(result).toEqual({ status: 'completed' });
    });
  });
});
