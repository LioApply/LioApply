import type { SupportedCvLanguage } from '../interfaces/cv/cv.interface';

/** Heuristic job-posting language detection (pt/en/es) based on stopword frequency. */
export function detectJobLanguage(text: string): SupportedCvLanguage {
  const lower = (text || '').toLowerCase();
  const tokens = lower.match(/[\p{L}]+/gu) || [];
  const freq = new Map<string, number>();
  for (const token of tokens) {
    freq.set(token, (freq.get(token) || 0) + 1);
  }
  const countWords = (words: string[]) => words.reduce((acc, w) => acc + (freq.get(w) || 0), 0);

  const enScore = countWords([
    'the', 'and', 'with', 'for', 'you', 'will', 'are', 'our', 'requirements', 'experience',
    'responsibilities', 'skills', 'about', 'your', 'have', 'from', 'this', 'looking', 'we',
    'position', 'candidate', 'qualifications', 'benefits', 'salary',
  ]);
  const ptScore =
    countWords([
      'para', 'com', 'que', 'uma', 'dos', 'das', 'nos', 'nas', 'como', 'requisitos',
      'experiência', 'responsabilidades', 'vaga', 'empresa', 'trabalho', 'equipe',
      'desenvolvedor', 'engenheiro', 'remoto', 'híbrido', 'benefícios', 'sobre', 'você',
      'nosso', 'nossa', 'conhecimento', 'conhecimentos', 'buscamos', 'anos', 'atuação',
      'atividades', 'diferenciais', 'salário', 'contratação', 'candidato', 'oportunidade',
    ]) + (lower.match(/[ãõç]/g)?.length || 0);
  const esScore =
    countWords([
      'para', 'con', 'que', 'una', 'los', 'las', 'como', 'requisitos', 'experiencia',
      'responsabilidades', 'puesto', 'empresa', 'trabajo', 'equipo', 'desarrollador',
      'ingeniero', 'remoto', 'híbrido', 'beneficios', 'sobre', 'nosotros', 'nuestro',
      'conocimientos', 'buscamos', 'años',
    ]) + (lower.match(/[ñ¿¡]/g)?.length || 0) * 2;

  if (ptScore >= enScore && ptScore >= esScore && ptScore > 0) return 'pt';
  if (esScore > ptScore && esScore > enScore) return 'es';
  if (enScore > ptScore && enScore >= esScore && enScore > 0) return 'en';
  return 'pt';
}
