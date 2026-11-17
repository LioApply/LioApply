import type {
  ChatProviderConfig,
  ClassifierProvider,
  ClassifierResolution,
  LlmMessage,
} from '../../interfaces/classifier/classifier.interface';
import type { ClassifierProviderConfig } from '../../services/classifier/classifier-clients';

export type ProviderProtocol = 'openai-compatible' | 'gemini' | 'jev';

export interface ProviderDefinition {
  id: string;
  protocol: ProviderProtocol;
  label: string;
  baseUrl: string;
  model: string;
  chatModel?: string;
  keyEnvs?: string[];
  urlEnvs?: string[];
  modelEnvs?: string[];
  requiresKey?: boolean;
  headers?: Record<string, string>;
  supportsChat?: boolean;
}

export interface ResolvedProviderConfig {
  id: string;
  label: string;
  apiKey: string;
  model: string;
  baseUrl: string;
  headers?: Record<string, string>;
}

export interface LlmProtocolAdapter {
  createClassifierClient(def: ProviderDefinition, resolved: ResolvedProviderConfig): ClassifierResolution;
  chatCompletion?(messages: LlmMessage[], config: ChatProviderConfig): Promise<string>;
}

const firstEnv = (names: string[] = []): string =>
  names.map((n) => process.env[n]).find(Boolean) || '';

/**
 * Entidade de domínio que encapsula identidade, capacidade e resolução de credenciais/endpoints
 * de um provider LLM ou System-One, delegando o transporte HTTP para um `LlmProtocolAdapter`.
 */
export class LlmProvider implements ClassifierProvider {
  readonly id: string;
  readonly protocol: ProviderProtocol;
  readonly supportsChat: boolean;

  constructor(
    public readonly definition: ProviderDefinition,
    private readonly adapter: LlmProtocolAdapter,
  ) {
    this.id = definition.id;
    this.protocol = definition.protocol;
    this.supportsChat = definition.supportsChat ?? definition.protocol !== 'jev';
  }

  isConfigured(): boolean {
    return Boolean(firstEnv(this.definition.keyEnvs));
  }

  createClient(config: ClassifierProviderConfig): ClassifierResolution | null {
    const resolved = this.resolveEndpointConfig(config, false);
    if (!resolved) return null;
    return this.adapter.createClassifierClient(this.definition, resolved);
  }

  resolveChatConfig(overrides?: Partial<ClassifierProviderConfig>): ChatProviderConfig {
    const resolved = this.resolveEndpointConfig(overrides, true, this.definition.chatModel)!;
    return {
      provider: this.id,
      providerLabel: resolved.label.replace(/\s*System-One$/i, '').replace(/\s*\(.*?\)$/, ''),
      apiKey: resolved.apiKey,
      model: resolved.model,
      baseUrl: resolved.baseUrl,
      ...(resolved.headers ? { extraHeaders: resolved.headers } : {}),
    };
  }

  async chatCompletion(messages: LlmMessage[], config: ChatProviderConfig): Promise<string> {
    if (!this.supportsChat || !this.adapter.chatCompletion) {
      throw new Error(`Provider "${this.id}" não suporta geração de texto (chatCompletion).`);
    }
    return this.adapter.chatCompletion(messages, config);
  }

  private resolveEndpointConfig(
    overrides: Partial<ClassifierProviderConfig> | undefined,
    throwOnMissingKey: boolean,
    preferredModel?: string,
  ): ResolvedProviderConfig | null {
    const d = this.definition;
    const rawKey = overrides?.apiKey || firstEnv(d.keyEnvs);
    const apiKey = rawKey || (d.requiresKey ? '' : this.id);

    if (d.requiresKey && !rawKey) {
      if (throwOnMissingKey) {
        throw new Error(
          `Chave de API para ${d.label} não configurada (defina ${d.keyEnvs?.join(', ')} ou CV_API_KEY).`,
        );
      }
      return null;
    }

    return {
      id: this.id,
      label: d.label,
      apiKey,
      model: overrides?.model || firstEnv(d.modelEnvs) || preferredModel || d.model,
      baseUrl: overrides?.baseUrl || firstEnv(d.urlEnvs) || d.baseUrl,
      headers: d.headers,
    };
  }
}
