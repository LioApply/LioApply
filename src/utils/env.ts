/** Returns the first defined, non-empty environment variable among `names` (or an empty string). */
export const firstEnv = (names: string[] = []): string => names.map((n) => process.env[n]).find(Boolean) || '';
