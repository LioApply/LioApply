import { LlmProvider, type ProviderDefinition, type ProviderOverrideEntry } from './llm-provider';

export const CLASSIFIER_PROVIDERS = 'CLASSIFIER_PROVIDERS';

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

export function createProviders(overrides?: Record<string, ProviderOverrideEntry>): LlmProvider[] {
  const defs = new Map<string, ProviderDefinition>(BUILTIN_PROVIDER_PRESETS.map((p) => [p.id, p]));

  for (const [rawId, entry] of Object.entries(overrides || {})) {
    const id = rawId.trim().toLowerCase();
    if (!id || !entry || typeof entry !== 'object') continue;

    const base = defs.get(id);
    const keyEnvs = entry.keyEnvs?.length ? entry.keyEnvs : entry.apiKeyEnv ? [entry.apiKeyEnv] : base?.keyEnvs;
    const merged: ProviderDefinition = {
      id,
      protocol: entry.protocol || base?.protocol || 'openai-compatible',
      label: entry.label || base?.label || id,
      baseUrl: entry.baseUrl || base?.baseUrl || '',
      model: entry.model || base?.model || '',
      chatModel: entry.chatModel ?? base?.chatModel,
      keyEnvs,
      urlEnvs: entry.urlEnvs ?? base?.urlEnvs,
      modelEnvs: entry.modelEnvs ?? base?.modelEnvs,
      requiresKey: entry.requiresKey ?? base?.requiresKey ?? Boolean(keyEnvs?.length),
      headers: entry.headers ?? base?.headers,
      supportsChat: entry.supportsChat ?? base?.supportsChat,
    };
    if (merged.baseUrl && merged.model) defs.set(id, merged);
  }

  return Array.from(defs.values()).map((def) => new LlmProvider(def));
}

export {
  LlmProvider,
  type ProviderDefinition,
  type ProviderOverrideEntry,
  type ProviderProtocol,
} from './llm-provider';
