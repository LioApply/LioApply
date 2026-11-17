import type {
  ChatProviderConfig,
  ClassifierProvider,
  ClassifierResolution,
  LlmMessage,
} from '../../../interfaces/classifier/classifier.interface';
import {
  type ClassifierProviderConfig,
  GeminiClassifierClient,
  NativeSystemOneHttpClient,
  OpenAiCompatibleClassifierClient,
  postJson,
} from '../classifier-clients';

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

interface ResolvedEndpoint {
  apiKey: string;
  model: string;
  baseUrl: string;
}

interface ProtocolAdapter {
  createClient(def: ProviderDefinition, r: ResolvedEndpoint): ClassifierResolution;
  chatCompletion?(messages: LlmMessage[], cfg: ChatProviderConfig): Promise<string>;
}

const firstEnv = (names: string[] = []): string =>
  names.map((n) => process.env[n]).find(Boolean) || '';

async function postChatJson<T>(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  label: string,
): Promise<T> {
  const res = await postJson(url, headers, body);
  if (!res.ok) throw new Error(`Erro na API do ${label} (${res.status}): ${await res.text()}`);
  return (await res.json()) as T;
}

const PROTOCOL_ADAPTERS: Record<ProviderProtocol, ProtocolAdapter> = {
  'openai-compatible': {
    createClient: (def, { apiKey, model, baseUrl }) => ({
      client: new OpenAiCompatibleClassifierClient({
        baseUrl,
        apiKey: apiKey || def.id,
        model,
        providerName: def.label,
        extraHeaders: def.headers,
      }),
      name: `${def.id} (${model})`,
    }),
    chatCompletion: async (messages, cfg) => {
      const data = await postChatJson<{ choices?: Array<{ message?: { content?: unknown } }> }>(
        cfg.baseUrl,
        { Authorization: `Bearer ${cfg.apiKey}`, ...(cfg.extraHeaders || {}) },
        {
          model: cfg.model,
          messages,
          temperature: 0.3,
          ...(cfg.provider !== 'openrouter' ? { response_format: { type: 'json_object' } } : {}),
        },
        cfg.providerLabel,
      );
      const content = data?.choices?.[0]?.message?.content;
      if (!content) throw new Error(`${cfg.providerLabel} retornou resposta vazia.`);
      return typeof content === 'string' ? content : JSON.stringify(content);
    },
  },
  gemini: {
    createClient: (_def, { apiKey, model, baseUrl }) => ({
      client: new GeminiClassifierClient({ apiKey, model, baseUrl }),
      name: `gemini (${model})`,
    }),
    chatCompletion: async (messages, cfg) => {
      const base = cfg.baseUrl.replace(/\/$/, '');
      const modelsBase = base.endsWith('/models') ? base : `${base}/models`;
      const endpoint = `${modelsBase}/${encodeURIComponent(cfg.model)}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`;
      const systemText = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
      const contents = messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));

      const data = await postChatJson<{ candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }>(
        endpoint,
        {},
        {
          ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
          contents,
          generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
        },
        'Gemini',
      );
      const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!content) throw new Error('Gemini retornou resposta vazia.');
      return content;
    },
  },
  jev: {
    createClient: (def, { apiKey, model, baseUrl }) => ({
      client: new NativeSystemOneHttpClient({
        baseUrl,
        apiKey: apiKey || undefined,
        model,
        providerName: def.label,
      }),
      name: `${def.id} (${baseUrl})`,
    }),
  },
};

export class LlmProvider implements ClassifierProvider {
  readonly id: string;
  readonly supportsChat: boolean;

  constructor(private readonly def: ProviderDefinition) {
    this.id = def.id;
    this.supportsChat = def.supportsChat ?? def.protocol !== 'jev';
  }

  isConfigured = (): boolean => Boolean(firstEnv(this.def.keyEnvs));

  createClient(config: ClassifierProviderConfig): ClassifierResolution | null {
    const resolved = this.resolveEndpoint(config, false);
    return resolved ? PROTOCOL_ADAPTERS[this.def.protocol].createClient(this.def, resolved) : null;
  }

  resolveChatConfig(overrides?: Partial<ClassifierProviderConfig>): ChatProviderConfig {
    const { apiKey, model, baseUrl } = this.resolveEndpoint(overrides, true, this.def.chatModel)!;
    return {
      provider: this.id,
      providerLabel: this.def.label.replace(/\s*System-One$/i, '').replace(/\s*\(.*?\)$/, ''),
      apiKey,
      model,
      baseUrl,
      ...(this.def.headers ? { extraHeaders: this.def.headers } : {}),
    };
  }

  async chatCompletion(messages: LlmMessage[], config: ChatProviderConfig): Promise<string> {
    const adapter = PROTOCOL_ADAPTERS[this.def.protocol];
    if (!this.supportsChat || !adapter.chatCompletion) {
      throw new Error(`Provider "${this.id}" não suporta geração de texto (chatCompletion).`);
    }
    return adapter.chatCompletion(messages, config);
  }

  private resolveEndpoint(
    overrides: Partial<ClassifierProviderConfig> | undefined,
    throwOnMissingKey: boolean,
    preferredModel?: string,
  ): ResolvedEndpoint | null {
    const d = this.def;
    const rawKey = overrides?.apiKey || firstEnv(d.keyEnvs);
    if (d.requiresKey && !rawKey) {
      if (throwOnMissingKey) {
        throw new Error(
          `Chave de API para ${d.label} não configurada (defina ${d.keyEnvs?.join(', ')} ou CV_API_KEY).`,
        );
      }
      return null;
    }
    return {
      apiKey: rawKey || this.id,
      model: overrides?.model || firstEnv(d.modelEnvs) || preferredModel || d.model,
      baseUrl: overrides?.baseUrl || firstEnv(d.urlEnvs) || d.baseUrl,
    };
  }
}
