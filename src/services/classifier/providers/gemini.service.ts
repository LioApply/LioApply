import { Injectable } from '@nestjs/common';
import { GeminiBaseProvider } from './base.provider';

@Injectable()
export class GeminiService extends GeminiBaseProvider {
  readonly id = 'gemini';
  protected readonly defaults = {
    label: 'Gemini System-One',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
    model: 'gemini-2.5-flash-lite',
    keyEnvs: ['GEMINI_API_KEY'],
    requiresKey: true,
  };
}
