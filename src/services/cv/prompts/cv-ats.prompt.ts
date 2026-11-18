import { BaseCvData, CvSectionTitles, CvTechnologies, type SupportedCvLanguage, type JobPostingInfo } from '../../../interfaces/cv/cv.interface';
import type { LlmMessage } from '../../../interfaces/classifier/classifier.interface';
import { detectJobLanguage } from '../../../utils/language';
import { COMPANY_NOT_INFORMED } from '../../../utils/defaults';

export const SECTION_TITLES_BY_LANG: Record<SupportedCvLanguage, CvSectionTitles> = {
  pt: {
    summary: 'Resumo Profissional',
    experience: 'Experiência Profissional',
    projects: 'Projetos',
    education: 'Educação',
    technologies: 'Habilidades Técnicas',
    languages: 'Certificações e Idiomas',
  },
  en: {
    summary: 'Professional Summary',
    experience: 'Professional Experience',
    projects: 'Projects',
    education: 'Education',
    technologies: 'Technical Skills',
    languages: 'Certifications & Languages',
  },
  es: {
    summary: 'Resumen Profesional',
    experience: 'Experiencia Profesional',
    projects: 'Proyectos',
    education: 'Educación',
    technologies: 'Habilidades Técnicas',
    languages: 'Certificaciones e Idiomas',
  },
};

export const TECH_LABELS_BY_LANG: Record<SupportedCvLanguage, Record<keyof CvTechnologies, string>> = {
  pt: {
    languages: 'Linguagens',
    frontend: 'Frontend',
    backend: 'Backend',
    databases: 'Bancos de Dados',
    devops: 'Cloud & DevOps',
    aiAndTools: 'IA & Ferramentas',
    practices: 'Práticas',
  },
  en: {
    languages: 'Languages',
    frontend: 'Frontend',
    backend: 'Backend',
    databases: 'Databases',
    devops: 'Cloud & DevOps',
    aiAndTools: 'AI & Tools',
    practices: 'Practices',
  },
  es: {
    languages: 'Lenguajes',
    frontend: 'Frontend',
    backend: 'Backend',
    databases: 'Bases de Datos',
    devops: 'Cloud & DevOps',
    aiAndTools: 'IA y Herramientas',
    practices: 'Prácticas',
  },
};

const LANG_DISPLAY: Record<SupportedCvLanguage, string> = {
  pt: 'Português (Portuguese)',
  en: 'English (Inglês)',
  es: 'Español (Spanish)',
};

const SYSTEM_PROMPT = `Você é um especialista sênior em engenharia de currículos para sistemas ATS (Gupy, Greenhouse, Lever, Workday) com restrição rigorosa de credibilidade factual para triagem técnica humana.

Seu objetivo é adaptar cirurgicamente as seções fornecidas do currículo do candidato para maximizar a pontuação de match na vaga alvo, SEM inventar empresas, datas ou cargos inexistentes e SEM gerar texto robótico ou inverossímil.

### REGRAS ABSOLUTAS (NÃO NEGOCIÁVEIS):
1. Preservação Factual:
   - Mantenha exatamente as mesmas empresas, períodos (dates) e todos os projetos reais do candidato (sem adicionar, remover ou renomear projetos).
   - Ajuste o campo "headline" (título principal abaixo do nome) para refletir o título da vaga alvo e as principais stacks pedidas na vaga.
   - Você pode ajustar levemente o título das experiências principais para alinhar à nomenclatura do cargo da vaga, sem mudar a natureza real da função exercida.
2. Extração e Densidade Controlada de Palavras-Chave (ATS):
   - Identifique de 5 a 8 palavras-chave técnicas obrigatórias da vaga (linguagens, frameworks, bancos, mensageria, cloud, arquitetura, práticas).
   - Inclua essas palavras-chave de forma natural:
     a) No "headline" e no "summary" (resumo profissional);
     b) Nos primeiros bullets ("description") das experiências mais relevantes para a vaga, descrevendo ação técnica e impacto concreto;
     c) Na seção "technologies", priorizando na frente as tecnologias exigidas na vaga em cada categoria ("languages", "frontend", "backend", "databases", "devops", "aiAndTools", "practices").
3. Idioma (Adaptação Obrigatória ao Idioma da Vaga):
   - Identifique o idioma predominante da vaga (priorizando "Descrição / Requisitos" e usando "Cargo" como apoio).
   - Gere TODO o conteúdo textual do JSON de saída exclusivamente nesse mesmo idioma, traduzindo e adaptando do currículo base quando necessário (NUNCA deixe trechos, datas, locais, graus acadêmicos, certificações ou rótulos em outro idioma):
     * "headline", "summary"
     * "experience[].title", "experience[].location" (ex: "Brasil" -> "Brazil", "Remoto" -> "Remote"), "experience[].dates" (mantendo exatamente os mesmos anos/números, traduzindo palavras como "Atual" -> "Present", meses como "Mai" -> "May"), e "experience[].description"
     * "projects[].techStack", "projects[].dates" (mantendo os mesmos anos/números, traduzindo meses/palavras) e "projects[].description"
     * "education[].degree", "education[].location" (ex: "Brasil" -> "Brazil"), "education[].dates" (mantenha exatamente instituição, nível do curso e anos originais; NUNCA adicione "em andamento", "in progress" ou "cursando" caso não esteja explícito no currículo base)
     * "certifications" (traduza descrições/níveis como "Nível B2" -> "Level B2", mantendo o nome oficial da certificação)
     * "languages" (traduza "language" e "level", ex: "Inglês" -> "English", "proficiência profissional" -> "professional working proficiency", "Português" -> "Portuguese", "nativo" -> "native")
     * "technologies" (traduza termos descritivos como em "practices", mantendo nomes próprios de linguagens/frameworks)
     * "techLabels" (traduza TODOS os rótulos das categorias: "languages", "frontend", "backend", "databases", "devops", "aiAndTools", "practices" — ex. em inglês: "Languages", "Frontend", "Backend", "Databases", "Cloud & DevOps", "AI & Tools", "Practices")
     * "sectionTitles" ("summary", "experience", "projects", "education", "technologies", "languages")
   - Exemplos de "sectionTitles" por idioma (para outros idiomas, traduza com terminologia profissional equivalente):
     * Português: "Resumo Profissional", "Experiência Profissional", "Projetos", "Educação", "Habilidades Técnicas", "Certificações e Idiomas"
     * English: "Professional Summary", "Professional Experience", "Projects", "Education", "Technical Skills", "Certifications & Languages"
     * Español: "Resumen Profesional", "Experiencia Profesional", "Proyectos", "Educación", "Habilidades Técnicas", "Certificaciones e Idiomas"
4. Formato de Saída:
   - Retorne EXCLUSIVAMENTE um objeto JSON válido (sem blocos markdown, sem comentários e sem texto antes ou depois) seguindo exatamente a estrutura solicitada.`;

const OUTPUT_SCHEMA_HINT = `{
  "headline": "<Título da vaga no idioma da vaga> | Stack 1 · Stack 2 · Stack 3 · Stack 4",
  "summary": "<Resumo profissional otimizado no idioma da vaga>",
  "experience": [{ "title": "<Cargo alinhado no idioma da vaga>", "company": "<Empresa original>", "location": "<Local traduzido>", "dates": "<Período traduzido mantendo os anos>", "description": ["<Bullet 1 no idioma da vaga>", "<Bullet 2 no idioma da vaga>"] }],
  "projects": [{ "name": "<Nome do projeto original>", "techStack": "<Stacks destacadas>", "dates": "<Data traduzida mantendo os anos>", "description": ["<Bullet no idioma da vaga>"] }],
  "education": [{ "institution": "<Instituição original>", "degree": "<Curso traduzido>", "location": "<Local traduzido>", "dates": "<Período traduzido>" }],
  "certifications": ["<Certificação com nível traduzido>"],
  "languages": [{ "language": "<Idioma traduzido>", "level": "<Nível traduzido>" }],
  "technologies": { "languages": "...", "frontend": "...", "backend": "...", "databases": "...", "devops": "...", "aiAndTools": "...", "practices": "<Práticas no idioma da vaga>" },
  "techLabels": { "languages": "<Rótulo traduzido>", "frontend": "Frontend", "backend": "Backend", "databases": "<Rótulo traduzido>", "devops": "Cloud & DevOps", "aiAndTools": "<Rótulo traduzido>", "practices": "<Rótulo traduzido>" },
  "sectionTitles": { "summary": "<Título no idioma da vaga>", "experience": "<Título no idioma da vaga>", "projects": "<Título no idioma da vaga>", "education": "<Título no idioma da vaga>", "technologies": "<Título no idioma da vaga>", "languages": "<Título no idioma da vaga>" }
}`;

export function buildAtsCvOptimizationPrompt(
  baseCv: BaseCvData,
  jobInfo: JobPostingInfo,
): LlmMessage[] {
  const { headline, summary, experience, projects, education, certifications, languages, technologies, techLabels, sectionTitles } = baseCv;
  const targetLang = detectJobLanguage(`${jobInfo.title}\n${jobInfo.description}`);
  const targetLangDisplay = LANG_DISPLAY[targetLang];
  const strictTranslationDirective =
    targetLang === 'en'
      ? 'CRITICAL: Write EVERY SINGLE FIELD in English. Translate all Portuguese dates ("Atual" -> "Present", "Mai" -> "May"), locations ("Brasil" -> "Brazil", "Remoto" -> "Remote"), degrees, certifications, language names/levels ("Inglês" -> "English", "Português" -> "Portuguese", "Nativo" -> "Native"), practices, techLabels, and sectionTitles into English. Do NOT leave any Portuguese words.'
      : targetLang === 'es'
        ? 'CRÍTICO: Escribe TODOS LOS CAMPOS en español. Traduce fechas ("Atual" -> "Actualidad"), ubicaciones ("Brasil" -> "Brasil", "Remoto" -> "Remoto"), títulos académicos, certificaciones, idiomas, practices, techLabels y sectionTitles al español.'
        : 'IMPORTANTE: Escreva TODOS os campos em Português (Brasil), incluindo títulos de seção e rótulos.';

  const userPrompt = `### IDIOMA OBRIGATÓRIO DE SAÍDA: ${targetLangDisplay}
${strictTranslationDirective}

### DADOS DA VAGA ALVO:
- Cargo: ${jobInfo.title}
- Empresa: ${jobInfo.company || COMPANY_NOT_INFORMED}
- Descrição / Requisitos:
${jobInfo.description}

### CURRÍCULO BASE DO CANDIDATO (JSON):
${JSON.stringify({ headline, summary, experience, projects, education, certifications, languages, technologies, techLabels, sectionTitles }, null, 2)}

Adapte e traduza TODO o conteúdo (incluindo datas, locais, educação, certificações, idiomas, "techLabels" e "sectionTitles") para **${targetLangDisplay}**. ${strictTranslationDirective} Retorne APENAS o JSON atualizado no formato exato abaixo:
${OUTPUT_SCHEMA_HINT}`;

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];
}
