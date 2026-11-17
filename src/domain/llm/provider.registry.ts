import {
  LlmProvider,
  type LlmProtocolAdapter,
  type ProviderDefinition,
  type ProviderProtocol,
} from './provider.entity';
import { BUILTIN_PROVIDER_PRESETS } from './provider.presets';

export type ProviderOverrideEntry = Partial<ProviderDefinition> & { apiKeyEnv?: string };

/**
 * Registry de domínio responsável por compor os presets nativos com as definições
 * declaradas pelo usuário em `jobs.config.yaml` e instanciar entidades `LlmProvider`.
 */
export class ProviderRegistry {
  private readonly providers = new Map<string, LlmProvider>();

  constructor(
    private readonly adapters: Record<ProviderProtocol, LlmProtocolAdapter>,
    presets: ProviderDefinition[] = BUILTIN_PROVIDER_PRESETS,
    overrides?: Record<string, ProviderOverrideEntry>,
  ) {
    const definitions = new Map<string, ProviderDefinition>(presets.map((p) => [p.id, p]));
    if (overrides) {
      for (const [rawId, entry] of Object.entries(overrides)) {
        const merged = this.mergeDefinition(rawId, entry, definitions.get(rawId.trim().toLowerCase()));
        if (merged) definitions.set(merged.id, merged);
      }
    }
    for (const def of definitions.values()) {
      this.providers.set(def.id, new LlmProvider(def, this.adapters[def.protocol]));
    }
  }

  getAll = (): LlmProvider[] => Array.from(this.providers.values());
  get = (id: string): LlmProvider | undefined => this.providers.get(id.trim().toLowerCase());

  private mergeDefinition(
    rawId: string,
    entry: ProviderOverrideEntry,
    base?: ProviderDefinition,
  ): ProviderDefinition | null {
    const id = rawId.trim().toLowerCase();
    if (!id || !entry || typeof entry !== 'object') return null;

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
    return merged.baseUrl && merged.model ? merged : null;
  }
}
