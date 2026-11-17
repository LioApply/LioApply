import { Injectable, Logger } from '@nestjs/common';
import { CreateInstanceDto } from '../../interfaces/ICreateInstanceDTO/icreateinstancedto.interface';
import { SendMediaDocumentDTO, SendMessageDTO } from '../../interfaces/SendMessageDTO';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  async createInstance(data: CreateInstanceDto) {
    this.logger.log(`Creating instance at: ${this.getBaseUrl()}/instance/create`);
    return this.request('POST', '/instance/create', 'Erro ao criar instância', {
      integration: 'WHATSAPP-BAILEYS',
      ...data,
    });
  }

  async connectInstance(instanceName: string) {
    this.logger.log(`Connecting instance: ${instanceName} at ${this.getBaseUrl()}/instance/connect/${instanceName}`);
    return this.request('GET', `/instance/connect/${instanceName}`, 'Erro ao conectar instância');
  }

  async sendMessage(message: SendMessageDTO) {
    const endpoint = `/message/sendText/${message.instanceName}`;
    this.logger.log(`📤 Enviando mensagem para: ${this.getBaseUrl()}${endpoint}`);
    const result = await this.request('POST', endpoint, 'Falha ao enviar mensagem na Evolution API', message);
    this.logger.log('✅ Mensagem enviada com sucesso!');
    return result;
  }

  async sendMediaDocument(mediaDto: SendMediaDocumentDTO) {
    const endpoint = `/message/sendMedia/${mediaDto.instanceName}`;
    this.logger.log(`📤 Enviando documento PDF (${mediaDto.fileName}) para: ${this.getBaseUrl()}${endpoint}`);
    const result = await this.request('POST', endpoint, 'Falha ao enviar documento PDF na Evolution API', {
      number: mediaDto.number,
      mediatype: 'document',
      mimetype: 'application/pdf',
      caption: mediaDto.caption || '',
      media: mediaDto.base64Pdf.replace(/^data:application\/pdf;base64,/, ''),
      fileName: mediaDto.fileName,
    });
    this.logger.log('✅ Documento PDF enviado com sucesso no WhatsApp!');
    return result;
  }

  private getBaseUrl = (): string => process.env.evolutionApiUrl || process.env.EVOLUTION_API_URL || '';

  private async request<T = unknown>(
    method: 'GET' | 'POST',
    endpoint: string,
    errorPrefix: string,
    payload?: unknown,
  ): Promise<T> {
    try {
      const response = await fetch(`${this.getBaseUrl()}${endpoint}`, {
        method,
        headers: {
          apikey: process.env.apiKey!,
          ...(payload !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
      });

      const body = await response.text();
      if (!response.ok) {
        const message = `${errorPrefix} (${response.status}): ${body}`;
        this.logger.error(`❌ ${message}`);
        throw new Error(message);
      }
      return body ? (JSON.parse(body) as T) : (undefined as T);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`❌ Fetch falhou: ${err.message}`, err.stack);
      throw error;
    }
  }
}
