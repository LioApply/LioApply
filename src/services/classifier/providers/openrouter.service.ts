import { Injectable } from '@nestjs/common';
import { OpenAiCompatibleProvider } from './base.provider';

@Injectable()
export class OpenRouterService extends OpenAiCompatibleProvider {
  readonly id = 'openrouter';
  protected readonly defaults = {
    label: 'OpenRouter System-One',
    baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'openrouter/free',
    keyEnvs: ['OPEN_ROUTER_API_KEY', 'OPENROUTER_API_KEY'],
    modelEnvs: ['OPENROUTER_MODEL'],
    requiresKey: true,
    headers: {
      'HTTP-Referer': 'https://github.com/LioApply/LioApply',
      'X-Title': 'LioApply System-One Classifier',
    },
  };
}
