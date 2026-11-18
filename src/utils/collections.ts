/** Splits a comma-separated string into trimmed, non-empty entries. */
export const csv = (value?: string): string[] =>
  value ? value.split(',').map((s) => s.trim()).filter(Boolean) : [];

/** Returns the value when it is an array, otherwise an empty array. */
export const arr = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

/** Returns `val` when it is a non-empty array, otherwise the fallback. */
export const nonEmptyArr = <T>(val: T[] | undefined, fallback: T[]): T[] =>
  Array.isArray(val) && val.length > 0 ? val : fallback;

/** Keeps only string entries with content, optionally dropping values listed in `blockedValues` (case-insensitive). */
export const pickNonEmptyRecord = <T extends Record<string, string | undefined>>(
  rec: T | undefined,
  blockedValues?: Set<string>,
): Partial<T> => {
  if (!rec || typeof rec !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec)) {
    const trimmed = typeof v === 'string' ? v.trim() : '';
    if (!trimmed) continue;
    if (blockedValues?.has(trimmed.toLowerCase())) continue;
    out[k] = trimmed;
  }
  return out as Partial<T>;
};
