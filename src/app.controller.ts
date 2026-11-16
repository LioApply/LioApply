import { Body, Controller, Get, Logger, Optional, Param, Post } from '@nestjs/common';
import { AppService } from './app.service';
import type { CreateInstanceDto } from './interfaces/ICreateInstanceDTO/icreateinstancedto.interface';
import type { SendMessageDTO } from './interfaces/SendMessageDTO';
import { CvOptimizationService } from './services/cv/cv-optimization.service';
import { PlaywrightService } from './services/playWrightService/scrapservice.service';
import { TaskService } from './services/task-service/task-service.service';
import { WhatsappService } from './services/whatsapp-service/whatsapp-service.service';

@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);

  constructor(
    private readonly appService: AppService,
    private readonly scrapService: PlaywrightService,
    private readonly whatsappService: WhatsappService,
    private readonly taskService: TaskService,
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
  sendMessage(@Body() data: SendMessageDTO, @Param('instanceName') _instanceName: string) {
    return this.whatsappService.sendMessage(data);
  }

  @Post('webhook/evolution')
  async handleEvolutionWebhook(@Body() payload: Record<string, any>) {
    if (!this.cvOptimizationService) {
      return { status: 'ignored', reason: 'CvOptimizationService unavailable' };
    }

    const eventData = Array.isArray(payload?.data) ? payload.data[0] : payload?.data || payload;
    const msg = eventData?.message || payload?.message || {};
    const text = msg?.conversation || msg?.extendedTextMessage?.text || payload?.text || '';
    const command = this.cvOptimizationService.parseCvCommand(String(text));
    if (!command) return { status: 'ignored' };

    const remoteJid: string = eventData?.key?.remoteJid || payload?.number || '';
    const senderNumber = remoteJid.endsWith('@s.whatsapp.net')
      ? remoteJid.split('@')[0]?.replace(/\D/g, '') || process.env.WHATSAPP_NUMBER
      : process.env.WHATSAPP_NUMBER;
    const instanceName = payload?.instance || process.env.INSTANCE_NAME || 'job-bot';

    this.logger.log(`📥 Comando de currículo recebido via WhatsApp: ${JSON.stringify(command)}`);
    const targetLabel = command.type === 'jobId' ? `vaga [#${command.jobId}]` : 'descrição/link enviado';
    await this.notifyWhatsApp(
      instanceName,
      senderNumber,
      `⏳ *Adaptando seu currículo para a ${targetLabel}...*\nAnalisando requisitos ATS e compilando PDF com Typst.`,
    );

    try {
      const opts = { sendWhatsapp: true, recipientNumber: senderNumber };
      const result =
        command.type === 'jobId'
          ? await this.cvOptimizationService.optimizeForStoredJobId(command.jobId, opts)
          : await this.cvOptimizationService.optimizeForCustomInput(command.input, opts);
      return { status: 'completed', fileName: result.fileName, evaluation: result.evaluation };
    } catch (error: any) {
      const errMsg = error?.message || String(error);
      this.logger.error(`❌ Erro ao processar comando /cv no WhatsApp: ${errMsg}`);
      await this.notifyWhatsApp(instanceName, senderNumber, `❌ *Não foi possível gerar o currículo:*\n${errMsg}`);
      return { status: 'error', message: errMsg };
    }
  }

  private async notifyWhatsApp(instanceName: string, number: string | undefined, text: string) {
    if (!number || !instanceName) return;
    await this.whatsappService.sendMessage({ instanceName, number, text, delay: 500 }).catch(() => undefined);
  }
}
