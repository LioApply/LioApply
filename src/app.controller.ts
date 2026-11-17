import { Body, Controller, Get, Optional, Param, Post } from '@nestjs/common';
import { AppService } from './app.service';
import type { CreateInstanceDto } from './interfaces/ICreateInstanceDTO/icreateinstancedto.interface';
import type { SendMessageDTO } from './interfaces/SendMessageDTO';
import { CvOptimizationService } from './services/cv/cv-optimization.service';
import { WhatsappService } from './services/whatsapp-service/whatsapp-service.service';

@Controller()
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
  create(@Body() data: CreateInstanceDto) {
    return this.whatsappService.createInstance(data);
  }

  @Get('instance/connect/:instanceName')
  connect(@Param('instanceName') instanceName: string) {
    return this.whatsappService.connectInstance(instanceName);
  }

  @Post('message/sendText/:instanceName')
  sendMessage(@Body() data: SendMessageDTO) {
    return this.whatsappService.sendMessage(data);
  }

  @Post('webhook/evolution')
  handleEvolutionWebhook(@Body() payload: Record<string, unknown>) {
    if (!this.cvOptimizationService) {
      return { status: 'ignored', reason: 'CvOptimizationService unavailable' };
    }
    return this.cvOptimizationService.handleEvolutionWebhook(payload);
  }
}
