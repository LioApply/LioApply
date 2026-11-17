import {
  clampProbability,
  extractJsonObject,
  NoulQuestion,
  SystemOneClient,
  SystemOneRequest,
  SystemOneResponse,
} from '../../utils/jev';

export type ClassifierProviderType = string;

export interface ClassifierProviderConfig {
  provider: ClassifierProviderType;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

const SYSTEM_ONE_PROMPT =
  'You are a non-conversational System-One NLI probability classifier. Evaluate `state` against each question in `questions` using its `true` and `false` criteria anchors. Respond ONLY with a flat JSON object mapping each exact question key to a calibrated probability float between 0.00 and 1.00. Never output explanations, prose, or markdown.';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isReasoningModel = (model: string) =>
  /gpt-oss|\bo[134](?:-|$)|deepseek-r1|\bqwq\b|qwen3|thinking|reasoning/i.test(model);

export const postJson = (url: string, headers: Record<string, string>, body: unknown, timeoutMs = 30000) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

export function buildCompactClassifierPayload<Q extends Record<string, NoulQuestion>>(
  request: SystemOneRequest<Q>,
): string {
  const rubricIds = new Map<string, string>();
  const rubrics: Record<string, { true: string; false: string }> = {};
  const questions: Record<string, { q: string; rubric: string }> = {};

  for (const [key, q] of Object.entries(request.questions)) {
    const sig = `${q.criteria.true}||${q.criteria.false}`;
    let id = rubricIds.get(sig);
    if (!id) {
      id = `R${rubricIds.size}`;
      rubricIds.set(sig, id);
      rubrics[id] = { true: q.criteria.true, false: q.criteria.false };
    }
    questions[key] = { q: q.instructions, rubric: id };
  }
  return JSON.stringify({ state: request.state, rubrics, questions });
}

export function parseSystemOneJsonOutput<Q extends Record<string, NoulQuestion>>(
  rawText: string,
  questions: Q,
): SystemOneResponse<Q> {
  const parsed = extractJsonObject<Record<string, unknown>>(
    rawText,
    'Classificador retornou resposta sem JSON válido',
  );
  const src =
    parsed.answers && typeof parsed.answers === 'object' ? (parsed.answers as Record<string, unknown>) : parsed;

  const answers = {} as SystemOneResponse<Q>['answers'];
  for (const key of Object.keys(questions) as Array<keyof Q>) {
    const val = src[key as string];
    const raw = val && typeof val === 'object' && 'noul' in val ? (val as { noul: unknown }).noul : val;
    answers[key] = { noul: clampProbability(raw, 0) };
  }
  return { answers };
}

export class OpenAiCompatibleClassifierClient implements SystemOneClient {
  constructor(
    private readonly options: {
      baseUrl: string;
      apiKey: string;
      model: string;
      providerName: string;
      extraHeaders?: Record<string, string>;
    },
  ) {}

  async systemOne<Q extends Record<string, NoulQuestion>>(request: SystemOneRequest<Q>): Promise<SystemOneResponse<Q>> {
    const { baseUrl, apiKey, model, providerName, extraHeaders } = this.options;
    const count = Object.keys(request.questions).length;
    const tokenBudgets = isReasoningModel(model)
      ? [Math.min(4096, Math.max(1024, count * 40 + 800)), Math.min(8192, Math.max(2048, count * 80 + 1500))]
      : [Math.min(1024, Math.max(80, count * 28)), Math.min(4096, Math.max(1024, count * 80))];

    const payload = buildCompactClassifierPayload(request);
    const isOpenRouter = baseUrl.includes('openrouter.ai');
    const isGroqGptOss = baseUrl.includes('api.groq.com') && /\bgpt-oss\b/i.test(model);

    let rateRetries = 0;
    let lastError = '';

    for (let attempt = 0; attempt < 2; ) {
      const res = await postJson(
        baseUrl,
        { Authorization: `Bearer ${apiKey}`, ...extraHeaders },
        {
          model,
          temperature: 0,
          top_p: 1,
          max_tokens: tokenBudgets[attempt],
          ...(isGroqGptOss ? { reasoning_effort: 'low' } : {}),
          ...(!isOpenRouter && attempt === 0 ? { response_format: { type: 'json_object' } } : {}),
          messages: [
            { role: 'system', content: SYSTEM_ONE_PROMPT },
            { role: 'user', content: payload },
          ],
        },
      );

      if (!res.ok) {
        const err = await res.text().catch(() => '');
        lastError = `[${providerName}] HTTP ${res.status}: ${err.slice(0, 250)}`;
        if (res.status === 429 && !/daily|per-day/i.test(err) && rateRetries++ < 3) {
          const sec = Number(
            res.headers.get('retry-after') || err.match(/try again in\s+([\d.]+)s/i)?.[1] || 2 * rateRetries,
          );
          await sleep(Math.min(30000, Math.ceil(sec * 1000) + 350));
          continue;
        }
        if ((isOpenRouter || err.includes('json_validate_failed')) && ++attempt < 2) continue;
        throw new Error(lastError);
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string | null; reasoning?: string | null } }>;
      };
      const msg = data.choices?.[0]?.message;
      const content = msg?.content?.trim() || msg?.reasoning?.trim() || '';

      try {
        if (!content) throw new Error(`[${providerName}] Resposta vazia.`);
        return parseSystemOneJsonOutput(content, request.questions);
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        if (++attempt >= 2) throw new Error(lastError);
      }
    }
    throw new Error(lastError);
  }
}

export class GeminiClassifierClient implements SystemOneClient {
  constructor(private readonly options: { apiKey: string; model: string; baseUrl?: string }) {}

  async systemOne<Q extends Record<string, NoulQuestion>>(request: SystemOneRequest<Q>): Promise<SystemOneResponse<Q>> {
    const { apiKey, model, baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models' } = this.options;
    const maxOutputTokens = Math.min(1024, Math.max(80, Object.keys(request.questions).length * 28));
    const url = `${baseUrl.replace(/\/$/, '')}/${model}:generateContent?key=${apiKey}`;

    const res = await postJson(url, {}, {
      systemInstruction: { parts: [{ text: SYSTEM_ONE_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: buildCompactClassifierPayload(request) }] }],
      generationConfig: { temperature: 0, topP: 1, maxOutputTokens, responseMimeType: 'application/json' },
    });

    if (!res.ok) throw new Error(`[Gemini] HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 250)}`);
    const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error(`[Gemini] Resposta vazia do modelo ${model}.`);
    return parseSystemOneJsonOutput(text, request.questions);
  }
}

export class NativeSystemOneHttpClient implements SystemOneClient {
  constructor(
    private readonly options: { baseUrl: string; apiKey?: string; model?: string; providerName: string },
  ) {}

  async systemOne<Q extends Record<string, NoulQuestion>>(request: SystemOneRequest<Q>): Promise<SystemOneResponse<Q>> {
    const { baseUrl, apiKey, model = 'jev-latest', providerName } = this.options;
    const endpoint = baseUrl.endsWith('/v1/systemone') ? baseUrl : `${baseUrl.replace(/\/$/, '')}/v1/systemone`;
    const res = await postJson(
      endpoint,
      apiKey ? { Authorization: `Bearer ${apiKey}`, 'x-api-key': apiKey } : {},
      { model, state: request.state, questions: request.questions },
      90000,
    );
    if (!res.ok) {
      throw new Error(`[${providerName}] HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 250)}`);
    }
    return parseSystemOneJsonOutput(await res.text(), request.questions);
  }
}
