import { BaseCvData } from '../../../interfaces/cv/cv.interface';

export interface LlmChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const SYSTEM_PROMPT = `Você é um especialista sênior em engenharia de currículos para sistemas ATS (Gupy, Greenhouse, Lever, Workday) com restrição rigorosa de credibilidade factual para triagem técnica humana.

Seu objetivo é adaptar cirurgicamente as seções fornecidas do currículo do candidato para maximizar a pontuação de match na vaga alvo, SEM inventar empresas, datas ou cargos inexistentes e SEM gerar texto robótico ou inverossímil.

### REGRAS ABSOLUTAS (NÃO NEGOCIÁVEIS):
1. Preservação Factual:
   - Mantenha exatamente as mesmas empresas, períodos (dates) e os 4 projetos reais do candidato.
   - Ajuste o campo "headline" (título principal abaixo do nome) para refletir o título da vaga alvo e as principais stacks pedidas na vaga.
   - Você pode ajustar levemente o título das experiências principais (ex: "Desenvolvedor Full Stack" / "Engenheiro de Software" / "Desenvolvedor Frontend/Backend") para alinhar à vaga.
2. Extração e Densidade Controlada de Palavras-Chave (ATS):
   - Identifique de 5 a 8 palavras-chave técnicas obrigatórias da vaga (linguagens, frameworks, bancos, mensageria, cloud, arquitetura, práticas).
   - Inclua essas palavras-chave de forma natural:
     a) No "headline" e no "summary" (resumo profissional);
     b) Nos primeiros bullets ("description") das experiências mais relevantes (GoWork Digital e The Public House), descrevendo ação técnica e impacto concreto;
     c) Na seção "technologies", priorizando na frente as tecnologias exigidas na vaga em cada categoria ("languages", "frontend", "backend", "databases", "devops", "aiAndTools", "practices").
3. Idioma:
   - O JSON de saída DEVE seguir integralmente o idioma da descrição da vaga:
     * Se a vaga estiver em português -> gere todo o texto e "sectionTitles" em português ("Resumo Profissional", "Experiência Profissional", "Projetos", "Educação", "Habilidades Técnicas", "Certificações e Idiomas").
     * Se a vaga estiver em inglês -> traduza todo o texto, períodos e "sectionTitles" ("Professional Summary", "Professional Experience", "Projects", "Education", "Technical Skills", "Certifications & Languages") para inglês profissional.
4. Formato de Saída:
   - Retorne EXCLUSIVAMENTE um objeto JSON válido (sem blocos markdown, sem comentários e sem texto antes ou depois) seguindo exatamente a estrutura solicitada.`;

const OUTPUT_SCHEMA_HINT = `{
  "headline": "Título da Vaga | Stack 1 · Stack 2 · Stack 3 · Stack 4",
  "summary": "Resumo profissional otimizado para a vaga...",
  "experience": [{ "title": "Cargo alinhado", "company": "Empresa original", "location": "Local original", "dates": "Período original", "description": ["Bullet 1...", "Bullet 2..."] }],
  "projects": [{ "name": "Nome do projeto original", "techStack": "Stacks destacadas", "dates": "Data original", "description": ["Bullet..."] }],
  "technologies": { "languages": "...", "frontend": "...", "backend": "...", "databases": "...", "devops": "...", "aiAndTools": "...", "practices": "..." },
  "sectionTitles": { "summary": "Resumo Profissional", "experience": "Experiência Profissional", "projects": "Projetos", "education": "Educação", "technologies": "Habilidades Técnicas", "languages": "Certificações e Idiomas" }
}`;

export function buildAtsCvOptimizationPrompt(
  baseCv: BaseCvData,
  jobInfo: { title: string; company?: string; description: string },
): LlmChatMessage[] {
  const { headline, summary, experience, projects, technologies, sectionTitles } = baseCv;
  const userPrompt = `### DADOS DA VAGA ALVO:
- Cargo: ${jobInfo.title}
- Empresa: ${jobInfo.company || 'Não informada'}
- Descrição / Requisitos:
${jobInfo.description}

### CURRÍCULO BASE DO CANDIDATO (JSON):
${JSON.stringify({ headline, summary, experience, projects, technologies, sectionTitles }, null, 2)}

Retorne APENAS o JSON atualizado no formato exato abaixo:
${OUTPUT_SCHEMA_HINT}`;

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];
}
