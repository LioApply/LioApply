import { Body, Controller, Get, Optional, Param, Post, UseGuards, UsePipes } from '@nestjs/common';
import { AppService } from './app.service';
import { CreateInstanceDto } from './interfaces/ICreateInstanceDTO/icreateinstancedto.interface';
import { SendMessageDTO } from './interfaces/SendMessageDTO';
import { CvOptimizationService } from './services/cv/cv-optimization.service';
import { WhatsappService } from './services/whatsapp-service/whatsapp-service.service';
import { ApiKeyAuthGuard, HttpValidationPipe, WebhookSecretGuard } from './utils/http-security';

@Controller()
@UsePipes(new HttpValidationPipe())
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly whatsappService: WhatsappService,
    @Optional() private readonly cvOptimizationService?: CvOptimizationService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Post('instance/create')
  @UseGuards(ApiKeyAuthGuard)
  create(@Body() data: CreateInstanceDto) {
    return this.whatsappService.createInstance(data);
  }

  @Get('instance/connect/:instanceName')
  @UseGuards(ApiKeyAuthGuard)
  connect(@Param('instanceName') instanceName: string) {
    return this.whatsappService.connectInstance(instanceName);
  }

  @Post('message/sendText/:instanceName')
  @UseGuards(ApiKeyAuthGuard)
  sendMessage(@Param('instanceName') instanceName: string, @Body() data: SendMessageDTO) {
    return this.whatsappService.sendMessage({
      ...data,
      instanceName: data.instanceName || instanceName,
    });
  }

  @Post('webhook/evolution')
  @UseGuards(WebhookSecretGuard)
  handleEvolutionWebhook(@Body() payload: Record<string, unknown>) {
    if (!this.cvOptimizationService) {
      return { status: 'ignored', reason: 'CvOptimizationService unavailable' };
    }
    return this.cvOptimizationService.handleEvolutionWebhook(payload);
  }
}
