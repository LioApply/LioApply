export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const postJson = (url: string, headers: Record<string, string>, body: unknown, timeoutMs = 30000) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

/** POSTs JSON and returns the parsed response body, throwing a labeled error on non-2xx. */
export async function postChatJson<T>(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  label: string,
): Promise<T> {
  const res = await postJson(url, headers, body);
  if (!res.ok) throw new Error(`Erro na API do ${label} (${res.status}): ${await res.text()}`);
  return (await res.json()) as T;
}
