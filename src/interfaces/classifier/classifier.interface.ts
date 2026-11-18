import type { SystemOneClient } from './system-one.interface';

export type ClassifierProviderType = string;

export interface ClassifierProviderConfig {
  provider: ClassifierProviderType;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

export interface JobEvaluationResult {
  shouldApply: boolean;
  score: number;
  reason: string;
}

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

export type ProviderOverrideEntry = Partial<ProviderDefinition> & { apiKeyEnv?: string };

export interface ResolvedEndpoint {
  apiKey: string;
  model: string;
  baseUrl: string;
}

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

export interface ProtocolAdapter {
  createClient(def: ProviderDefinition, r: ResolvedEndpoint): ClassifierResolution;
  chatCompletion?(messages: LlmMessage[], cfg: ChatProviderConfig): Promise<string>;
}
