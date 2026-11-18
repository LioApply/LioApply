/** Collapses any run of whitespace into a single space and trims the result. */
export const collapseSpaces = (value: string): string => value.replace(/\s+/g, ' ').trim();

/** Escapes WhatsApp markdown control characters so user content cannot break message formatting. */
export const escapeWhatsappMarkdown = (text: string): string => text.replace(/([_*~`])/g, '\\$1');

/** Returns the trimmed string when non-empty, otherwise the fallback. */
export const nonEmpty = (val: unknown, fallback?: string): string | undefined =>
  typeof val === 'string' && val.trim() ? val.trim() : fallback;

/** Normalizes an unknown value into a list of trimmed, non-empty strings (or the fallback when not an array). */
export const cleanList = (val: unknown, fallback: string[] = []): string[] =>
  Array.isArray(val) ? val.map((d) => String(d).trim()).filter(Boolean) : fallback;
