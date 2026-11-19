import { BadRequestException, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CvOptimizationService } from './services/cv/cv-optimization.service';
import { WhatsappService } from './services/whatsapp-service/whatsapp-service.service';
import { CreateInstanceDto } from './interfaces/ICreateInstanceDTO/icreateinstancedto.interface';
import { SendMessageDTO } from './interfaces/SendMessageDTO';
import { ApiKeyAuthGuard, HttpValidationPipe, WebhookSecretGuard } from './utils/http-security';

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

  describe('HTTP Security Guards & ValidationPipe (#28)', () => {
    const originalEnv = process.env;
    const mockContext = (req: Record<string, unknown>): ExecutionContext =>
      ({
        switchToHttp: () => ({ getRequest: () => req }),
      }) as unknown as ExecutionContext;

    beforeEach(() => {
      process.env = { ...originalEnv };
      delete process.env.HTTP_API_KEY;
      delete process.env.AUTHENTICATION_API_KEY;
      delete process.env.apiKey;
      delete process.env.WEBHOOK_SECRET;
      delete process.env.EVOLUTION_WEBHOOK_SECRET;
    });

    afterAll(() => {
      process.env = originalEnv;
    });

    it('enforces ApiKeyAuthGuard on administrative routes', () => {
      const guard = new ApiKeyAuthGuard();
      expect(() => guard.canActivate(mockContext({ headers: {} }))).toThrow(UnauthorizedException);

      process.env.AUTHENTICATION_API_KEY = 'secret-123';
      expect(() => guard.canActivate(mockContext({ headers: { apikey: 'wrong' } }))).toThrow(UnauthorizedException);
      expect(guard.canActivate(mockContext({ headers: { apikey: 'secret-123' } }))).toBe(true);
      expect(guard.canActivate(mockContext({ headers: { authorization: 'Bearer secret-123' } }))).toBe(true);
    });

    it('enforces WebhookSecretGuard when WEBHOOK_SECRET is configured', () => {
      const guard = new WebhookSecretGuard();
      expect(guard.canActivate(mockContext({ headers: {}, body: {} }))).toBe(true);

      process.env.WEBHOOK_SECRET = 'wh-sec-999';
      expect(() => guard.canActivate(mockContext({ headers: {}, query: {} }))).toThrow(UnauthorizedException);
      expect(guard.canActivate(mockContext({ headers: { 'x-webhook-secret': 'wh-sec-999' } }))).toBe(true);
      expect(guard.canActivate(mockContext({ headers: {}, query: { secret: 'wh-sec-999' } }))).toBe(true);
    });

    it('validates CreateInstanceDto, SendMessageDTO, and :instanceName param at runtime', () => {
      const pipe = new HttpValidationPipe();

      expect(() =>
        pipe.transform({ instanceName: 'bad name!' }, { type: 'body', metatype: CreateInstanceDto }),
      ).toThrow(BadRequestException);

      const validCreate = pipe.transform(
        { instanceName: 'job-bot', qrcode: true },
        { type: 'body', metatype: CreateInstanceDto },
      ) as CreateInstanceDto;
      expect(validCreate.instanceName).toBe('job-bot');

      expect(() =>
        pipe.transform({ number: 'invalid', text: 'hi' }, { type: 'body', metatype: SendMessageDTO }),
      ).toThrow(BadRequestException);

      const validMsg = pipe.transform(
        { number: '5511999999999', text: 'Olá!', delay: 500 },
        { type: 'body', metatype: SendMessageDTO },
      ) as SendMessageDTO;
      expect(validMsg.number).toBe('5511999999999');

      expect(() =>
        pipe.transform('../etc/passwd', { type: 'param', data: 'instanceName', metatype: String }),
      ).toThrow(BadRequestException);
    });
  });
});
