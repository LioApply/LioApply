import type { LlmProtocolAdapter, ProviderProtocol } from '../../domain/llm/provider.entity';
import type { ChatProviderConfig, LlmMessage } from '../../interfaces/classifier/classifier.interface';
import {
  GeminiClassifierClient,
  NativeSystemOneHttpClient,
  OpenAiCompatibleClassifierClient,
} from '../../services/classifier/classifier-clients';

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

export const LLM_PROTOCOL_ADAPTERS: Record<ProviderProtocol, LlmProtocolAdapter> = {
  'openai-compatible': {
    createClassifierClient: (def, { apiKey, model, baseUrl }) => ({
      client: new OpenAiCompatibleClassifierClient({
        baseUrl,
        apiKey: apiKey || def.id,
        model,
        providerName: def.label,
        extraHeaders: def.headers,
      }),
      name: `${def.id} (${model})`,
    }),
    chatCompletion: async (messages: LlmMessage[], cfg: ChatProviderConfig) => {
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
    createClassifierClient: (def, { apiKey, model, baseUrl }) => ({
      client: new GeminiClassifierClient({ apiKey, model, baseUrl }),
      name: `${def.id} (${model})`,
    }),
    chatCompletion: async (messages: LlmMessage[], cfg: ChatProviderConfig) => {
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
    createClassifierClient: (def, { apiKey, model, baseUrl }) => ({
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
