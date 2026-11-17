import { GenericLlmProvider, type ProviderDefinition } from './base.provider';
import { BUILTIN_PROVIDER_DEFINITIONS } from './presets';

export const CLASSIFIER_PROVIDERS = 'CLASSIFIER_PROVIDERS';

export type ProviderOverrideEntry = Partial<ProviderDefinition> & { apiKeyEnv?: string };

export const createLlmProvider = (definition: ProviderDefinition): GenericLlmProvider =>
  new GenericLlmProvider(definition);

export function createProviders(overrides?: Record<string, ProviderOverrideEntry>): GenericLlmProvider[] {
  const registry = new Map<string, ProviderDefinition>(
    BUILTIN_PROVIDER_DEFINITIONS.map((def) => [def.id, def]),
  );

  if (overrides) {
    for (const [rawId, entry] of Object.entries(overrides)) {
      const id = rawId.trim().toLowerCase();
      if (!id || !entry || typeof entry !== 'object') continue;

      const base = registry.get(id);
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
      if (merged.baseUrl && merged.model) registry.set(id, merged);
    }
  }

  return Array.from(registry.values()).map(createLlmProvider);
}

export {
  GenericLlmProvider,
  type ProviderDefaults,
  type ProviderDefinition,
  type ProviderProtocol,
} from './base.provider';
export { BUILTIN_PROVIDER_DEFINITIONS } from './presets';
