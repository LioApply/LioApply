import { Logger } from '@nestjs/common';
import {
  ChatProviderConfig,
  ClassifierProvider,
  ClassifierResolution,
  LlmMessage,
} from '../../../interfaces/classifier/classifier.interface';
import {
  ClassifierProviderConfig,
  ClassifierProviderType,
  GeminiClassifierClient,
  NativeSystemOneHttpClient,
  OpenAiCompatibleClassifierClient,
} from '../classifier-clients';

export type ProviderProtocol = 'openai-compatible' | 'gemini' | 'jev';

export interface ProviderDefaults {
  label: string;
  baseUrl: string;
  model: string;
  chatModel?: string;
  keyEnvs?: string[];
  urlEnvs?: string[];
  modelEnvs?: string[];
  requiresKey?: boolean;
  headers?: Record<string, string>;
}

export interface ProviderDefinition extends ProviderDefaults {
  id: string;
  protocol: ProviderProtocol;
  supportsChat?: boolean;
}

const firstEnv = (names: string[] = []) => names.map((n) => process.env[n]).find(Boolean) || '';

interface Resolved {
  apiKey: string;
  model: string;
  baseUrl: string;
}

const postChatJson = async <T>(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  label: string,
): Promise<T> => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Erro na API do ${label} (${res.status}): ${await res.text()}`);
  return (await res.json()) as T;
};

interface ProtocolHandler {
  build: (def: ProviderDefinition, r: Resolved) => ClassifierResolution;
  chatCompletion?: (messages: LlmMessage[], cfg: ChatProviderConfig) => Promise<string>;
}

const PROTOCOL_HANDLERS: Record<ProviderProtocol, ProtocolHandler> = {
  'openai-compatible': {
    build: (def, { apiKey, model, baseUrl }) => ({
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
    build: (def, { apiKey, model, baseUrl }) => ({
      client: new GeminiClassifierClient({ apiKey, model, baseUrl }),
      name: `${def.id} (${model})`,
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
    build: (def, { apiKey, model, baseUrl }) => ({
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

/** Entidade genérica de provider LLM/System-One orientada por configuração declarativa. */
export class GenericLlmProvider implements ClassifierProvider {
  readonly id: ClassifierProviderType;
  readonly supportsChat: boolean;
  private readonly logger: Logger;

  constructor(public readonly definition: ProviderDefinition) {
    this.id = definition.id;
    this.supportsChat = definition.supportsChat ?? definition.protocol !== 'jev';
    this.logger = new Logger(`Provider(${definition.id})`);
  }

  isConfigured = (): boolean => Boolean(firstEnv(this.definition.keyEnvs));

  createClient(config: ClassifierProviderConfig): ClassifierResolution | null {
    const d = this.definition;
    const apiKey = config.apiKey || firstEnv(d.keyEnvs);
    if (d.requiresKey && !apiKey) {
      this.logger.warn(
        `⚠️ CLASSIFIER_PROVIDER=${this.id} selecionado, mas ${d.keyEnvs?.join(' / ')} / CLASSIFIER_API_KEY não foi encontrada.`,
      );
      return null;
    }
    return PROTOCOL_HANDLERS[d.protocol].build(d, {
      apiKey,
      model: config.model || firstEnv(d.modelEnvs) || d.model,
      baseUrl: config.baseUrl || firstEnv(d.urlEnvs) || d.baseUrl,
    });
  }

  resolveChatConfig(overrides?: Partial<ClassifierProviderConfig>): ChatProviderConfig {
    const d = this.definition;
    const apiKey = overrides?.apiKey || firstEnv(d.keyEnvs) || (d.requiresKey ? '' : this.id);
    if (d.requiresKey && !apiKey) {
      throw new Error(
        `Chave de API para ${d.label} não configurada (defina ${d.keyEnvs?.join(', ')} ou CV_API_KEY).`,
      );
    }
    return {
      provider: this.id,
      providerLabel: d.label.replace(/\s*System-One$/i, '').replace(/\s*\(.*?\)$/, ''),
      apiKey,
      model: overrides?.model || firstEnv(d.modelEnvs) || d.chatModel || d.model,
      baseUrl: overrides?.baseUrl || firstEnv(d.urlEnvs) || d.baseUrl,
      ...(d.headers ? { extraHeaders: d.headers } : {}),
    };
  }

  async chatCompletion(messages: LlmMessage[], config: ChatProviderConfig): Promise<string> {
    const handler = PROTOCOL_HANDLERS[this.definition.protocol];
    if (!handler.chatCompletion) {
      throw new Error(`Provider "${this.id}" não suporta chatCompletion.`);
    }
    return handler.chatCompletion(messages, config);
  }
}
