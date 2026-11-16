import { Injectable } from '@nestjs/common';
import { OpenAiCompatibleProvider } from './base.provider';

@Injectable()
export class GroqService extends OpenAiCompatibleProvider {
  readonly id = 'groq';
  protected readonly defaults = {
    label: 'Groq System-One',
    baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'openai/gpt-oss-120b',
    chatModel: 'llama-3.3-70b-versatile',
    keyEnvs: ['GROQ_API_KEY'],
    requiresKey: true,
  };
}
