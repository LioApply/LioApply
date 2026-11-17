import type { ProviderDefinition } from './provider.entity';

export const BUILTIN_PROVIDER_PRESETS: ProviderDefinition[] = [
  {
    id: 'groq',
    protocol: 'openai-compatible',
    label: 'Groq System-One',
    baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'openai/gpt-oss-120b',
    keyEnvs: ['GROQ_API_KEY'],
    requiresKey: true,
  },
  {
    id: 'gemini',
    protocol: 'gemini',
    label: 'Gemini System-One',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
    model: 'gemini-2.5-flash-lite',
    keyEnvs: ['GEMINI_API_KEY'],
    requiresKey: true,
  },
  {
    id: 'openrouter',
    protocol: 'openai-compatible',
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
  },
  {
    id: 'ollama',
    protocol: 'openai-compatible',
    label: 'Local/OpenAI (ollama)',
    baseUrl: 'http://localhost:11434/v1/chat/completions',
    model: 'qwen2.5:3b',
  },
  {
    id: 'jev',
    protocol: 'jev',
    supportsChat: false,
    label: 'SystemOne (jev)',
    baseUrl: 'https://api.typesafe.ai/v1/systemone',
    model: 'jev-latest',
    keyEnvs: ['TYPESAFE_API_KEY', 'JEV_API_KEY'],
  },
];
