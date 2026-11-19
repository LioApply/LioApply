import { BadRequestException } from '@nestjs/common';

export class SendMessageDTO {
  instanceName!: string;
  number!: string;
  text!: string;
  delay!: number;
  linkPreview?: string;

  static validate(raw: unknown): SendMessageDTO {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new BadRequestException('Corpo inválido para envio de mensagem.');
    }
    const obj = raw as Record<string, unknown>;
    const number = typeof obj.number === 'string' ? obj.number.trim() : '';
    if (!number || !/^\+?\d{8,16}(?:@s\.whatsapp\.net)?$/.test(number)) {
      throw new BadRequestException('Campo "number" é obrigatório e deve ser um número WhatsApp válido.');
    }
    const text = typeof obj.text === 'string' ? obj.text.trim() : '';
    if (!text) {
      throw new BadRequestException('Campo "text" é obrigatório e não pode ser vazio.');
    }
    const instanceName = typeof obj.instanceName === 'string' ? obj.instanceName.trim() : '';
    if (instanceName && !/^[a-zA-Z0-9_-]{1,64}$/.test(instanceName)) {
      throw new BadRequestException('Campo "instanceName" inválido.');
    }
    const delay = obj.delay !== undefined ? Number(obj.delay) : 0;
    if (!Number.isFinite(delay) || delay < 0 || delay > 60000) {
      throw new BadRequestException('Campo "delay" deve ser um número entre 0 e 60000.');
    }

    return Object.assign(new SendMessageDTO(), obj, {
      instanceName,
      number,
      text,
      delay,
    });
  }
}

export interface SendMediaDocumentDTO {
  instanceName: string;
  number: string;
  fileName: string;
  base64Pdf: string;
  caption?: string;
}
