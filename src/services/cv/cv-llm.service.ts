import { Injectable, Logger } from '@nestjs/common';
import {
  BaseCvData,
  CvLlmProviderType,
  CvTailoredPatchDto,
} from '../../interfaces/cv/cv.interface';
import {
  buildAtsCvOptimizationPrompt,
  LlmChatMessage,
} from './prompts/cv-ats.prompt';
import { JobConfigService } from '../../config/job-config.service';

interface ResolvedCvLlmProvider {
  provider: Exclude<CvLlmProviderType, 'auto'>;
  providerLabel: string;
  apiKey: string;
  model: string;
  baseUrl: string;
  extraHeaders?: Record<string, string>;
}

const SYSTEM_ONE_ONLY_PROVIDERS = new Set(['jev', 'systemone', 'none']);

@Injectable()
export class CvLlmService {
  private readonly logger = new Logger(CvLlmService.name);

  constructor(private readonly jobConfigService: JobConfigService) {}

  async generateTailoredCvPatch(
    baseCv: BaseCvData,
    jobInfo: { title: string; company?: string; description: string },
  ): Promise<CvTailoredPatchDto> {
    const resolved = this.resolveLlmProvider();
    const messages = buildAtsCvOptimizationPrompt(baseCv, jobInfo);

    this.logger.log(
      `🤖 Solicitando adaptação ATS via ${resolved.providerLabel} (modelo: ${resolved.model}) para a vaga "${jobInfo.title}"...`,
    );

    const rawText =
      resolved.provider === 'gemini'
        ? await this.callGemini(resolved, messages)
        : await this.callOpenAiCompatible(resolved, messages);

    return this.parseTailoredPatchJson(rawText, baseCv);
  }

  /**
   * Resolves the active generative LLM provider for CV optimization (`groq`, `gemini`, `openrouter`, `ollama`, `openai-compatible`).
   */
  resolveLlmProvider(): ResolvedCvLlmProvider {
    const cvConfig = this.jobConfigService.getCvOptimizationConfig();
    const requested = (cvConfig.provider || 'auto').trim().toLowerCase();

    if (SYSTEM_ONE_ONLY_PROVIDERS.has(requested)) {
      throw new Error(
        `Provider "${requested}" é apenas um classificador System-One e não suporta geração de currículo. Use groq, gemini, openrouter, ollama ou openai-compatible.`,
      );
    }

    const explicitApiKey = process.env.CV_API_KEY || '';
    const customModel = cvConfig.model || '';
    const customBaseUrl = cvConfig.baseUrl || '';

    const provider = this.resolveAutoProvider(requested as CvLlmProviderType);

    switch (provider) {
      case 'groq': {
        const apiKey = explicitApiKey || process.env.GROQ_API_KEY || '';
        if (!apiKey) {
          throw new Error(
            'CV_PROVIDER=groq selecionado, mas GROQ_API_KEY / CV_API_KEY não configurada.',
          );
        }
        return {
          provider: 'groq',
          providerLabel: 'Groq',
          apiKey,
          model: customModel || 'llama-3.3-70b-versatile',
          baseUrl:
            customBaseUrl || 'https://api.groq.com/openai/v1/chat/completions',
        };
      }

      case 'gemini': {
        const apiKey = explicitApiKey || process.env.GEMINI_API_KEY || '';
        if (!apiKey) {
          throw new Error(
            'CV_PROVIDER=gemini selecionado, mas GEMINI_API_KEY / CV_API_KEY não configurada.',
          );
        }
        return {
          provider: 'gemini',
          providerLabel: 'Gemini',
          apiKey,
          model: customModel || 'gemini-2.5-flash-lite',
          baseUrl:
            customBaseUrl || 'https://generativelanguage.googleapis.com/v1beta',
        };
      }

      case 'ollama':
      case 'openai-compatible': {
        return {
          provider,
          providerLabel: provider === 'ollama' ? 'Ollama' : 'OpenAI-Compatible',
          apiKey: explicitApiKey || 'ollama',
          model: customModel || 'qwen2.5:3b',
          baseUrl:
            customBaseUrl || 'http://localhost:11434/v1/chat/completions',
        };
      }

      case 'openrouter':
      default: {
        const apiKey =
          explicitApiKey ||
          process.env.OPEN_ROUTER_API_KEY ||
          process.env.OPENROUTER_API_KEY ||
          '';
        if (!apiKey) {
          throw new Error(
            'Chave de API para otimização de CV não configurada (defina GROQ_API_KEY, GEMINI_API_KEY, OPEN_ROUTER_API_KEY ou CV_API_KEY).',
          );
        }
        return {
          provider: 'openrouter',
          providerLabel: 'OpenRouter',
          apiKey,
          model: customModel || cvConfig.openRouterModel || 'openrouter/free',
          baseUrl:
            customBaseUrl || 'https://openrouter.ai/api/v1/chat/completions',
          extraHeaders: {
            'HTTP-Referer': 'https://github.com/LioApply/LioApply',
            'X-Title': 'LioApply CV Optimizer',
          },
        };
      }
    }
  }

  private resolveAutoProvider(
    requested: CvLlmProviderType,
  ): Exclude<CvLlmProviderType, 'auto'> {
    if (requested && requested !== 'auto') {
      return requested;
    }

    if (process.env.GROQ_API_KEY) return 'groq';
    if (process.env.GEMINI_API_KEY) return 'gemini';
    if (process.env.OPEN_ROUTER_API_KEY || process.env.OPENROUTER_API_KEY) {
      return 'openrouter';
    }
    if (process.env.CV_BASE_URL) return 'openai-compatible';
    return 'openrouter';
  }

  private async callOpenAiCompatible(
    config: ResolvedCvLlmProvider,
    messages: LlmChatMessage[],
  ): Promise<string> {
    const bodyPayload: Record<string, unknown> = {
      model: config.model,
      messages,
      temperature: 0.3,
    };

    if (config.provider !== 'openrouter') {
      bodyPayload.response_format = { type: 'json_object' };
    }

    const response = await fetch(config.baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        ...(config.extraHeaders || {}),
      },
      body: JSON.stringify(bodyPayload),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(
        `Erro na API do ${config.providerLabel} (${response.status}): ${errBody}`,
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };

    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error(`${config.providerLabel} retornou resposta vazia.`);
    }

    return typeof content === 'string' ? content : JSON.stringify(content);
  }

  private async callGemini(
    config: ResolvedCvLlmProvider,
    messages: LlmChatMessage[],
  ): Promise<string> {
    const base = config.baseUrl.replace(/\/$/, '');
    const endpoint = `${base}/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`;

    const systemText = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(systemText
          ? { systemInstruction: { parts: [{ text: systemText }] } }
          : {}),
        contents,
        generationConfig: {
          temperature: 0.3,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Erro na API do Gemini (${response.status}): ${errBody}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };

    const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) {
      throw new Error('Gemini retornou resposta vazia.');
    }

    return content;
  }

  /**
   * Strips <think> blocks and markdown code fences, then parses and validates the JSON patch.
   */
  parseTailoredPatchJson(
    rawText: string,
    fallbackBase: BaseCvData,
  ): CvTailoredPatchDto {
    const withoutThink = rawText
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .trim();
    const firstBrace = withoutThink.indexOf('{');
    const lastBrace = withoutThink.lastIndexOf('}');

    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw new Error(
        'A resposta do modelo de IA não contém um objeto JSON válido.',
      );
    }

    const jsonCandidate = withoutThink.slice(firstBrace, lastBrace + 1);
    const parsed = JSON.parse(jsonCandidate) as Partial<CvTailoredPatchDto>;

    return {
      headline:
        typeof parsed.headline === 'string' && parsed.headline.trim().length > 0
          ? parsed.headline.trim()
          : fallbackBase.headline,
      summary:
        typeof parsed.summary === 'string' && parsed.summary.trim().length > 0
          ? parsed.summary.trim()
          : fallbackBase.summary,
      experience:
        Array.isArray(parsed.experience) && parsed.experience.length > 0
          ? parsed.experience.map((exp, idx) => {
              const orig = fallbackBase.experience[idx];
              return {
                title: exp.title || orig?.title || 'Desenvolvedor',
                company: orig?.company || exp.company || '',
                location: orig?.location || exp.location || '',
                dates: orig?.dates || exp.dates || '',
                description: Array.isArray(exp.description)
                  ? exp.description.map((d) => String(d).trim()).filter(Boolean)
                  : orig?.description || [],
              };
            })
          : fallbackBase.experience,
      projects:
        Array.isArray(parsed.projects) && parsed.projects.length > 0
          ? parsed.projects.map((proj, idx) => {
              const orig = fallbackBase.projects[idx];
              return {
                name: orig?.name || proj.name || 'Projeto',
                techStack: proj.techStack || orig?.techStack,
                link: orig?.link || proj.link,
                dates: orig?.dates || proj.dates,
                description: Array.isArray(proj.description)
                  ? proj.description
                      .map((d) => String(d).trim())
                      .filter(Boolean)
                  : orig?.description || [],
              };
            })
          : fallbackBase.projects,
      technologies:
        parsed.technologies && typeof parsed.technologies === 'object'
          ? {
              ...fallbackBase.technologies,
              ...parsed.technologies,
            }
          : fallbackBase.technologies,
      sectionTitles:
        parsed.sectionTitles && typeof parsed.sectionTitles === 'object'
          ? parsed.sectionTitles
          : fallbackBase.sectionTitles,
    };
  }
}
