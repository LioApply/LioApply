import { Injectable } from '@nestjs/common';
import { OpenAiCompatibleProvider } from './base.provider';

@Injectable()
export class OllamaService extends OpenAiCompatibleProvider {
  readonly id = 'ollama';
  protected readonly defaults = {
    label: 'Local/OpenAI (ollama)',
    baseUrl: 'http://localhost:11434/v1/chat/completions',
    model: 'qwen2.5:3b',
  };
}
