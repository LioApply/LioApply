import { nonEmpty } from './text';

const sanitizeFilePart = (value: string, fallback: string): string =>
  (value || fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 35);

export const buildSafePdfFileName = (candidateName: string, targetSuffix: string): string =>
  `Curriculo_${sanitizeFilePart(candidateName, 'Candidato')}_${sanitizeFilePart(targetSuffix, 'Vaga')}.pdf`;

/** Accepts an LLM-translated date only when it keeps the same years as the original; otherwise keeps the original. */
export const preserveTranslatedDate = (candidate: unknown, original?: string): string => {
  const next = nonEmpty(candidate);
  if (!next) return original || '';
  if (!original) return next;
  const origYears: string[] = original.match(/\b\d{4}\b/g) || [];
  const nextYears: string[] = next.match(/\b\d{4}\b/g) || [];
  const yearsConsistent =
    origYears.length === 0 || (nextYears.length > 0 && nextYears.every((y) => origYears.includes(y)));
  return yearsConsistent ? next : original;
};
