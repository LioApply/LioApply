import type { CvCommand, ParsedEvolutionWebhook } from '../../interfaces/cv/cv-webhook.interface';

/** Parses `/cv <id>`, `cv <id>`, `gerar cv <id>`, `otimizar cv <id>` or `/cv <free text|url>`. */
export function parseCvCommand(messageText: string): CvCommand | null {
  if (!messageText) return null;
  const trimmed = messageText.trim();
  const idMatch = trimmed.match(/^(?:\/cv|cv|gerar\s+cv|otimizar\s+cv)\s+#?(\d+)\s*$/i);
  if (idMatch?.[1]) return { type: 'jobId', jobId: Number(idMatch[1]) };

  const customMatch = trimmed.match(/^\/cv\s+([\s\S]+)$/i);
  return customMatch?.[1]?.trim() ? { type: 'custom', input: customMatch[1].trim() } : null;
}

/** Normalizes the different Evolution API webhook payload shapes into a flat structure. */
export function parseEvolutionWebhook(payload: Record<string, unknown>): ParsedEvolutionWebhook {
  const data = payload?.data;
  const eventData = (Array.isArray(data) ? data[0] : data || payload) as Record<string, any>;
  const msg = (eventData?.message || payload?.message || {}) as Record<string, any>;
  const text = msg?.conversation || msg?.extendedTextMessage?.text || payload?.text || '';

  const remoteJid = String(eventData?.key?.remoteJid || payload?.number || '');
  const senderNumber = remoteJid.endsWith('@s.whatsapp.net')
    ? remoteJid.split('@')[0]?.replace(/\D/g, '') || undefined
    : undefined;

  return {
    fromMe: eventData?.key?.fromMe === true,
    text: String(text),
    senderNumber,
    instance: payload?.instance ? String(payload.instance) : undefined,
  };
}
