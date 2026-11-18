import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { TypstTemplateService } from './typst-template.service';
import { TypstCompilerService } from './typst-compiler.service';
import { CvLlmService } from './cv-llm.service';
import { createProviders } from '../classifier/providers';
import { CvOptimizationService } from './cv-optimization.service';
import { BaseCvData } from '../../interfaces/cv/cv.interface';
import { CvConfigService } from './cv-config.service';

describe('CV Optimization Pipeline Services', () => {
  let templateService: TypstTemplateService;
  let compilerService: TypstCompilerService;
  let sampleBaseCv: BaseCvData;

  beforeAll(() => {
    templateService = new TypstTemplateService();
    compilerService = new TypstCompilerService();
    const cvYamlPath = path.resolve(process.cwd(), 'cv.base.example.yaml');
    sampleBaseCv = YAML.parse(
      fs.readFileSync(cvYamlPath, 'utf8'),
    ) as BaseCvData;
  });

  describe('TypstTemplateService', () => {
    it('should escape special Typst markup characters safely', () => {
      const escaped = templateService.escapeTypst(
        'C# & Node.js *100%* _fast_ $100 @user [tag] #hash',
      );
      expect(escaped).toContain('C\\#');
      expect(escaped).toContain('\\*100%\\*');
      expect(escaped).toContain('\\_fast\\_');
      expect(escaped).toContain('\\$100');
      expect(escaped).toContain('\\[tag\\]');
    });

    it('should preserve immutable fields when merging base CV with LLM patch', () => {
      const merged = templateService.mergeBaseWithPatch(sampleBaseCv, {
        summary: 'Resumo adaptado para vaga Backend Node.js e NestJS.',
        technologies: {
          backend: 'NestJS, Node.js, TypeScript, PostgreSQL',
        },
      });

      expect(merged.name).toBe(sampleBaseCv.name);
      expect(merged.contact.email).toBe(sampleBaseCv.contact.email);
      expect(merged.education).toEqual(sampleBaseCv.education);
      expect(merged.summary).toBe(
        'Resumo adaptado para vaga Backend Node.js e NestJS.',
      );
      expect(merged.technologies.backend).toBe(
        'NestJS, Node.js, TypeScript, PostgreSQL',
      );
    });

    it('should compile cv.base.example.yaml into a valid PDF buffer using Typst', async () => {
      const typstDoc = templateService.renderTypstDocument(sampleBaseCv, {
        title: 'Desenvolvedor Full Stack Pleno',
        company: 'Acme Tech',
      });

      expect(typstDoc).toContain(sampleBaseCv.name);
      expect(typstDoc).toContain(sampleBaseCv.experience[0].company);

      const pdfBuffer = await compilerService.compileToPdfBuffer(typstDoc);
      expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
      expect(pdfBuffer.length).toBeGreaterThan(2000);
      expect(pdfBuffer.subarray(0, 4).toString('ascii')).toBe('%PDF');
    });
  });

  describe('CvLlmService', () => {
    it('should strip <think> blocks and markdown fences and preserve original company/dates', () => {
      const mockConfigService = {
        getCvOptimizationConfig: jest.fn().mockReturnValue({
          model: 'openrouter/free',
          baseCvPath: './cv.base.yaml',
        }),
      } as unknown as CvConfigService;

      const llmService = new CvLlmService(mockConfigService);

      const rawOutput = `<think>Reasoning about ATS keywords...</think>
\`\`\`json
{
  "summary": "Full Stack Developer specialized in React, Next.js, and NestJS.",
  "experience": [
    {
      "title": "Full Stack Software Engineer",
      "company": "Hallucinated Corp",
      "location": "Mars",
      "dates": "2099",
      "description": [
        "Built scalable REST APIs with NestJS, TypeScript, and PostgreSQL."
      ]
    }
  ],
  "projects": [],
  "technologies": {
    "backend": "NestJS, Node.js, TypeScript"
  },
  "sectionTitles": {
    "summary": "Professional Summary"
  }
}
\`\`\``;

      const patch = llmService.parseTailoredPatchJson(rawOutput, sampleBaseCv);

      expect(patch.summary).toBe(
        'Full Stack Developer specialized in React, Next.js, and NestJS.',
      );
      // Must preserve original company, location, and dates from baseCv
      expect(patch.experience[0].company).toBe(
        sampleBaseCv.experience[0].company,
      );
      expect(patch.experience[0].dates).toBe(sampleBaseCv.experience[0].dates);
      expect(patch.experience[0].title).toBe('Full Stack Software Engineer');
      expect(patch.sectionTitles?.summary).toBe('Professional Summary');
    });
  });

  describe('CvOptimizationService', () => {
    it('should parse /cv commands for job ID and custom input', () => {
      const cvOptService = new CvOptimizationService(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        templateService,
        compilerService,
        {} as any,
      );

      expect(cvOptService.parseCvCommand('/cv 42')).toEqual({
        type: 'jobId',
        jobId: 42,
      });
      expect(cvOptService.parseCvCommand('/cv #15')).toEqual({
        type: 'jobId',
        jobId: 15,
      });
      expect(cvOptService.parseCvCommand('gerar cv 7')).toEqual({
        type: 'jobId',
        jobId: 7,
      });
      expect(
        cvOptService.parseCvCommand(
          '/cv Vaga Desenvolvedor React Pleno com TypeScript',
        ),
      ).toEqual({
        type: 'custom',
        input: 'Vaga Desenvolvedor React Pleno com TypeScript',
      });
      expect(cvOptService.parseCvCommand('bom dia')).toBeNull();
    });

    it('should orchestrate full optimization for a stored job ID and send PDF via BotService', async () => {
      const mockConfigService = {
        getBaseCv: jest.fn().mockReturnValue(sampleBaseCv),
      };
      const mockHistoryRepo = {
        getJobById: jest.fn().mockResolvedValue({
          id: 42,
          title: 'Desenvolvedor Full Stack Node/React',
          company: 'TechCorp',
          url: 'https://example.com/jobs/42',
          description:
            'Requisitos: React, Next.js, Node.js, NestJS, Docker, PostgreSQL, testes automatizados com Jest e CI/CD.',
        }),
      };
      const mockLlmService = {
        generateTailoredCvPatch: jest.fn().mockResolvedValue({
          summary:
            'Desenvolvedor Full Stack com sólida experiência em React, Next.js, Node.js, NestJS, PostgreSQL e Docker.',
          experience: sampleBaseCv.experience,
          projects: sampleBaseCv.projects,
          technologies: sampleBaseCv.technologies,
        }),
      };
      const mockClassifierService = {
        evaluateTailoredCv: jest.fn().mockResolvedValue({
          isCredible: true,
          credibilityProbability: 0.95,
          atsScore: 92,
          summaryReason: 'Aderência ATS estimada: 92%',
        }),
      };
      const mockBotService = {
        sendMediaDocument: jest.fn().mockResolvedValue(undefined),
      };

      process.env.INSTANCE_NAME = 'job-bot';
      process.env.WHATSAPP_NUMBER = '5579988043018';

      const cvOptService = new CvOptimizationService(
        mockConfigService as any,
        mockHistoryRepo as any,
        mockLlmService as any,
        mockClassifierService as any,
        templateService,
        compilerService,
        mockBotService as any,
      );

      try {
        const res = await cvOptService.optimizeForStoredJobId(42);

        expect(res.fileName).toContain('TechCorp.pdf');
        expect(res.pdfBuffer.subarray(0, 4).toString('ascii')).toBe('%PDF');
        expect(mockBotService.sendMediaDocument).toHaveBeenCalledTimes(1);
        expect(mockBotService.sendMediaDocument).toHaveBeenCalledWith(
          expect.objectContaining({
            instanceName: 'job-bot',
            number: '5579988043018',
            fileName: res.fileName,
          }),
        );
      } finally {
        await cvOptService.onModuleDestroy();
      }
    });
  });

  describe('CvLlmService Provider Resolution', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
      delete process.env.CV_PROVIDER;
      delete process.env.CV_MODEL;
      delete process.env.CV_API_KEY;
      delete process.env.CV_BASE_URL;
      delete process.env.GROQ_API_KEY;
      delete process.env.GEMINI_API_KEY;
      delete process.env.OPEN_ROUTER_API_KEY;
      delete process.env.OPENROUTER_API_KEY;
      delete process.env.OPENROUTER_MODEL;
    });

    afterAll(() => {
      process.env = originalEnv;
    });

    it('resolves groq, gemini, ollama, and openrouter providers and rejects jev', () => {
      const makeService = (provider?: any, model?: string) =>
        new CvLlmService({
          getCvOptimizationConfig: jest.fn().mockReturnValue({
            provider: provider ?? 'auto',
            model,
            baseCvPath: './cv.base.yaml',
          }),
        } as unknown as CvConfigService);

      process.env.GROQ_API_KEY = 'gsk-test';
      expect(makeService('groq').resolveLlmProvider()).toMatchObject({
        provider: 'groq',
        model: 'openai/gpt-oss-120b',
      });

      process.env.GEMINI_API_KEY = 'gem-test';
      expect(makeService('gemini').resolveLlmProvider()).toMatchObject({
        provider: 'gemini',
        model: 'gemini-2.5-flash-lite',
      });

      expect(makeService('ollama').resolveLlmProvider()).toMatchObject({
        provider: 'ollama',
        model: 'qwen2.5:3b',
      });

      process.env.OPEN_ROUTER_API_KEY = 'or-test';
      expect(makeService('openrouter').resolveLlmProvider()).toMatchObject({
        provider: 'openrouter',
        model: 'openrouter/free',
      });

      expect(() => makeService('jev').resolveLlmProvider()).toThrow(
        /System-One/,
      );
    });

    it('reads cvOptimization provider, model, and baseUrl from JobConfigService like classifier', () => {
      const cfgService = new CvConfigService({
        getConfig: () => ({
          cvOptimization: {
            provider: 'groq',
            model: 'openai/gpt-oss-120b',
            baseUrl: 'https://custom.groq.local/v1',
          },
        }),
      } as any);

      expect(cfgService.getCvOptimizationConfig()).toMatchObject({
        provider: 'groq',
        model: 'openai/gpt-oss-120b',
        baseUrl: 'https://custom.groq.local/v1',
      });

      const defaultCfgService = new CvConfigService();
      expect(defaultCfgService.getCvOptimizationConfig()).toMatchObject({
        provider: 'auto',
        model: undefined,
        baseUrl: undefined,
      });

      process.env.CV_PROVIDER = 'openrouter';
      process.env.CV_MODEL = 'openrouter/free';
      process.env.CV_BASE_URL = 'https://custom.or.local/v1';
      expect(cfgService.getCvOptimizationConfig()).toMatchObject({
        provider: 'openrouter',
        model: 'openrouter/free',
        baseUrl: 'https://custom.or.local/v1',
      });
    });

    it('resolves custom declarative providers and preset overrides in CvLlmService', () => {
      process.env.DEEPSEEK_API_KEY = 'ds-test';
      try {
        const customProviders = createProviders({
          deepseek: {
            protocol: 'openai-compatible',
            baseUrl: 'https://api.deepseek.com/v1/chat/completions',
            model: 'deepseek-chat',
            apiKeyEnv: 'DEEPSEEK_API_KEY',
          },
        });
        const customCfgService = new CvConfigService({
          getConfig: () => ({ cvOptimization: { provider: 'deepseek' } }),
        } as any);

        expect(new CvLlmService(customCfgService, customProviders).resolveLlmProvider()).toMatchObject({
          provider: 'deepseek',
          model: 'deepseek-chat',
          baseUrl: 'https://api.deepseek.com/v1/chat/completions',
        });
      } finally {
        delete process.env.DEEPSEEK_API_KEY;
      }
    });

    it('handles Evolution webhook commands and ignores unrelated messages', async () => {
      const botMock = { sendMessage: jest.fn().mockResolvedValue(undefined), sendMediaDocument: jest.fn() };
      const service = new CvOptimizationService(
        { getBaseCv: () => ({ name: 'Dev' }) } as any,
        { getJobById: jest.fn().mockResolvedValue({ id: 7, title: 'Dev Node', company: 'ACME' }) } as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        botMock as any,
      );

      expect(await service.handleEvolutionWebhook({ text: 'olá' })).toEqual({ status: 'ignored' });
      expect(
        await service.handleEvolutionWebhook({
          instance: 'bot',
          data: { key: { fromMe: true, remoteJid: '5511999999999@s.whatsapp.net' }, message: { conversation: '/cv 7' } },
        }),
      ).toEqual({ status: 'ignored', reason: 'fromMe' });

      const spy = jest.spyOn(service, 'optimizeForStoredJobId').mockResolvedValue({
        pdfBuffer: Buffer.from('pdf'),
        fileName: 'cv.pdf',
        evaluation: { isCredible: true, credibilityProbability: 1, atsScore: 90, summaryReason: 'OK' },
        tailoredCv: {} as any,
      });

      const res = await service.handleEvolutionWebhook({
        instance: 'bot',
        data: { key: { remoteJid: '5511999999999@s.whatsapp.net' }, message: { conversation: '/cv 7' } },
      });

      expect(spy).toHaveBeenCalledWith(7, { sendWhatsapp: true, recipientNumber: '5511999999999', instanceName: 'bot' });
      expect(botMock.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ instanceName: 'bot', number: '5511999999999' }));
      expect(res).toMatchObject({ status: 'completed', fileName: 'cv.pdf' });
    });
  });
});
