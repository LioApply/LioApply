import { BadRequestException } from '@nestjs/common';

const ALLOWED_INTEGRATIONS = new Set(['WHATSAPP-BAILEYS', 'WHATSAPP-BUSINESS', 'EVOLUTION']);

export class CreateInstanceDto {
  instanceName!: string;
  token?: string;
  qrcode?: boolean;
  integration?: 'WHATSAPP-BAILEYS' | 'WHATSAPP-BUSINESS' | 'EVOLUTION';
  number?: string;
  rejectCall?: boolean;
  msgCall?: string;
  groupsIgnore?: boolean;
  alwaysOnline?: boolean;
  readMessages?: boolean;
  readStatus?: boolean;
  syncFullHistory?: boolean;

  static validate(raw: unknown): CreateInstanceDto {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new BadRequestException('Corpo inválido para criação de instância.');
    }
    const obj = raw as Record<string, unknown>;
    const instanceName = typeof obj.instanceName === 'string' ? obj.instanceName.trim() : '';
    if (!instanceName || !/^[a-zA-Z0-9_-]{1,64}$/.test(instanceName)) {
      throw new BadRequestException('Campo "instanceName" é obrigatório e deve conter apenas letras, números, "_" ou "-".');
    }
    if (obj.integration !== undefined) {
      if (typeof obj.integration !== 'string' || !ALLOWED_INTEGRATIONS.has(obj.integration)) {
        throw new BadRequestException('Campo "integration" inválido.');
      }
    }
    if (obj.qrcode !== undefined && typeof obj.qrcode !== 'boolean') {
      throw new BadRequestException('Campo "qrcode" deve ser booleano.');
    }
    if (obj.number !== undefined && (typeof obj.number !== 'string' || !/^\+?\d{8,16}$/.test(obj.number.trim()))) {
      throw new BadRequestException('Campo "number" deve conter um telefone válido em dígitos.');
    }

    return Object.assign(new CreateInstanceDto(), obj, { instanceName });
  }
}
