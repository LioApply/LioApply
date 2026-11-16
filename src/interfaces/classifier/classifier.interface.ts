import type { SystemOneClient } from '../../utils/jev';
import type {
  ClassifierProviderConfig,
  ClassifierProviderType,
} from '../../services/classifier/classifier-clients';

export interface ClassifierResolution {
  client: SystemOneClient;
  name: string;
}

export interface ChatProviderConfig {
  provider: ClassifierProviderType;
  providerLabel: string;
  apiKey: string;
  model: string;
  baseUrl: string;
  extraHeaders?: Record<string, string>;
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ClassifierProvider {
  readonly id: ClassifierProviderType;
  readonly supportsChat?: boolean;
  /** True quando há credencial no ambiente (usado na auto-detecção). */
  isConfigured(): boolean;
  /** Cria o client System-One, ou `null` se faltar credencial obrigatória. */
  createClient(config: ClassifierProviderConfig): ClassifierResolution | null;
  /** Resolve configuração HTTP para geração de texto/JSON (CV LLM). */
  resolveChatConfig?(overrides?: Partial<ClassifierProviderConfig>): ChatProviderConfig;
  /** Executa chat completion no protocolo específico do provider. */
  chatCompletion?(messages: LlmMessage[], config: ChatProviderConfig): Promise<string>;
}
