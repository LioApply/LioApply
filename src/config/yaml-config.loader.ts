import * as fs from 'fs';
import * as YAML from 'yaml';

export interface YamlLoadResult<T> {
  data: T;
  source: string;
}

export const csv = (value?: string): string[] =>
  value ? value.split(',').map((s) => s.trim()).filter(Boolean) : [];

export const arr = <T>(value: unknown): T[] =>
  Array.isArray(value) ? (value as T[]) : [];

export const findExistingFile = (candidates: Array<string | undefined>): string | undefined =>
  candidates.filter((c): c is string => Boolean(c)).find((c) => fs.existsSync(c));

export const parseYamlObject = <T extends object>(content: string): T | undefined => {
  const parsed = YAML.parse(content);
  return parsed && typeof parsed === 'object' ? (parsed as T) : undefined;
};

export function loadYamlFromFile<T extends object>(
  candidatePaths: Array<string | undefined>,
  onError?: (filePath: string, error: Error) => void,
): YamlLoadResult<T> | undefined {
  const filePath = findExistingFile(candidatePaths);
  if (!filePath) return undefined;
  try {
    const data = parseYamlObject<T>(fs.readFileSync(filePath, 'utf8'));
    return data ? { data, source: filePath } : undefined;
  } catch (error) {
    onError?.(filePath, error as Error);
    throw error;
  }
}
