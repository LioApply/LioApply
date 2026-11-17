import { JobConfigService } from '../../config/job-config.service';
import { JOB_FIT_QUESTIONS, noul, UserProfileCriteria } from '../../utils/jev';
import {
  buildCompactClassifierPayload,
  OpenAiCompatibleClassifierClient,
  parseSystemOneJsonOutput,
} from './classifier-clients';
import { createClassifierService } from './classifier.service';

describe('ClassifierService (System-One multi-provider)', () => {
  const sampleProfile: UserProfileCriteria = {
    targetRoles: ['Desenvolvedor Full Stack Pleno'],
    targetTechnologies: ['TypeScript', 'React', 'Node.js', 'NestJS'],
    acceptableLevels: ['Júnior', 'Pleno'],
    excludedLevels: ['Sênior', 'Estágio'],
    locations: ['Remoto'],
  };

  const originalEnv = process.env;
  const makeService = (yaml: Record<string, unknown> = {}) =>
    createClassifierService({
      getClassifierConfig: () => yaml,
    } as unknown as JobConfigService);

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.CLASSIFIER_PROVIDER;
    delete process.env.CLASSIFIER_API_KEY;
    delete process.env.CLASSIFIER_MODEL;
    delete process.env.CLASSIFIER_BASE_URL;
    delete process.env.GROQ_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPEN_ROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    delete process.env.JEV_API_KEY;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('buildCompactClassifierPayload & parseSystemOneJsonOutput', () => {
    it('deduplicates identical criteria rubrics across batch questions to save input tokens', () => {
      const payloadStr = buildCompactClassifierPayload({
        state: { candidates: [{ id: 0 }, { id: 1 }] },
        questions: {
          job_0_matches_profile: noul(
            'Match job 0?',
            JOB_FIT_QUESTIONS.matches_profile.criteria,
          ),
          job_1_matches_profile: noul(
            'Match job 1?',
            JOB_FIT_QUESTIONS.matches_profile.criteria,
          ),
        },
      });

      const parsed = JSON.parse(payloadStr);
      expect(Object.keys(parsed.rubrics)).toEqual(['R0']);
      expect(parsed.questions.job_0_matches_profile.rubric).toBe('R0');
      expect(parsed.questions.job_1_matches_profile.rubric).toBe('R0');
    });

    it('parses both flat probability maps and nested System-One answer objects', () => {
      const flatParsed = parseSystemOneJsonOutput(
        '{"matches_profile": 0.88, "is_actual_job_offer": 0.96}',
        JOB_FIT_QUESTIONS,
      );
      expect(flatParsed.answers.matches_profile.noul).toBe(0.88);
      expect(flatParsed.answers.is_actual_job_offer.noul).toBe(0.96);

      const nestedParsed = parseSystemOneJsonOutput(
        '{"answers": {"matches_profile": {"noul": 0.72}, "is_actual_job_offer": {"noul": 0.91}}}',
        JOB_FIT_QUESTIONS,
      );
      expect(nestedParsed.answers.matches_profile.noul).toBe(0.72);
      expect(nestedParsed.answers.is_actual_job_offer.noul).toBe(0.91);
    });
  });

  describe('Provider Selection & Auto-Detection', () => {
    it('auto-detects OpenRouter when OPEN_ROUTER_API_KEY is present', () => {
      process.env.OPEN_ROUTER_API_KEY = 'sk-or-test';
      const service = makeService();
      expect(service.getActiveProviderName()).toContain('openrouter');
    });

    it('prioritizes explicit CLASSIFIER_PROVIDER selection (groq, gemini, ollama)', () => {
      process.env.CLASSIFIER_PROVIDER = 'groq';
      process.env.GROQ_API_KEY = 'gsk-test';
      const groqService = makeService();
      expect(groqService.getActiveProviderName()).toContain('groq');

      process.env.CLASSIFIER_PROVIDER = 'gemini';
      process.env.GEMINI_API_KEY = 'ai-studio-test';
      const geminiService = makeService();
      expect(geminiService.getActiveProviderName()).toContain('gemini');

      process.env.CLASSIFIER_PROVIDER = 'ollama';
      const ollamaService = makeService();
      expect(ollamaService.getActiveProviderName()).toContain('ollama');
    });

    it('routes to the provider chosen in jobs.config.yaml', () => {
      expect(
        makeService({
          provider: 'ollama',
          model: 'qwen2.5:3b',
        }).getActiveProviderName(),
      ).toBe('ollama (qwen2.5:3b)');
    });
  });

  describe('Job & Batch Evaluation', () => {
    it('evaluates single and batch jobs using the System-One client contract', async () => {
      const service = makeService();
      const mockSystemOne = jest.fn().mockImplementation(async (req) => {
        const answers: Record<string, { noul: number }> = {};
        for (const key of Object.keys(req.questions)) {
          if (key.includes('job_0') || key === 'matches_profile') {
            answers[key] = { noul: 0.85 };
          } else if (key.includes('is_actual_job_offer')) {
            answers[key] = { noul: 0.95 };
          } else {
            answers[key] = { noul: 0.2 };
          }
        }
        return { answers };
      });

      service.setClientForTesting(
        { systemOne: mockSystemOne },
        'mock-provider',
      );

      const batchResults = await service.evaluateJobsBatch(
        [
          {
            title: 'Desenvolvedor Full Stack Pleno (Node/React)',
            company: 'Acme Tech',
            text: 'Contratamos dev pleno TypeScript, React e NestJS remoto.',
          },
          {
            title: 'Especialista Cobol Sênior',
            company: 'Legacy Corp',
            text: 'Vaga sênior Cobol mainframe presencial.',
          },
        ],
        sampleProfile,
      );

      expect(mockSystemOne).toHaveBeenCalledTimes(1);
      expect(batchResults).toHaveLength(2);
      expect(batchResults[0].shouldApply).toBe(true);
      expect(batchResults[0].score).toBe(85);
      expect(batchResults[1].shouldApply).toBe(false);
      expect(batchResults[1].score).toBe(20);
    });

    it('allocates reasoning headroom and retries truncated JSON for Groq gpt-oss models', async () => {
      const originalFetch = global.fetch;
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            model: 'openai/gpt-oss-120b',
            choices: [
              {
                finish_reason: 'length',
                message: {
                  content: '{"matches_profile":0.04,"is_actual_job_offer":0',
                },
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            model: 'openai/gpt-oss-120b',
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  content: '{"matches_profile":0.04,"is_actual_job_offer":0.95}',
                },
              },
            ],
          }),
        });
      global.fetch = fetchMock as unknown as typeof fetch;

      try {
        const client = new OpenAiCompatibleClassifierClient({
          baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
          apiKey: 'gsk-test',
          model: 'openai/gpt-oss-120b',
          providerName: 'Groq System-One',
        });

        const result = await client.systemOne({
          state: { title: 'Test Job' },
          questions: JOB_FIT_QUESTIONS,
        });

        expect(result.answers.matches_profile.noul).toBe(0.04);
        expect(result.answers.is_actual_job_offer.noul).toBe(0.95);
        expect(fetchMock).toHaveBeenCalledTimes(2);

        const firstBody = JSON.parse(
          (fetchMock.mock.calls[0][1] as RequestInit).body as string,
        ) as Record<string, unknown>;
        const secondBody = JSON.parse(
          (fetchMock.mock.calls[1][1] as RequestInit).body as string,
        ) as Record<string, unknown>;

        expect(firstBody.reasoning_effort).toBe('low');
        expect(Number(firstBody.max_tokens)).toBeGreaterThanOrEqual(1024);
        expect(Number(secondBody.max_tokens)).toBeGreaterThanOrEqual(2048);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('supports custom declarative providers and preset overrides from config', () => {
      process.env.DEEPSEEK_API_KEY = 'ds-test';
      try {
        const cfgMock = {
          getClassifierConfig: () => ({ provider: 'deepseek' }),
          getConfig: () => ({
            providers: {
              deepseek: {
                protocol: 'openai-compatible' as const,
                baseUrl: 'https://api.deepseek.com/v1/chat/completions',
                model: 'deepseek-chat',
                apiKeyEnv: 'DEEPSEEK_API_KEY',
              },
            },
          }),
        } as unknown as JobConfigService;

        const service = createClassifierService(cfgMock);
        expect(service.getActiveProviderName()).toBe('deepseek (deepseek-chat)');
      } finally {
        delete process.env.DEEPSEEK_API_KEY;
      }
    });
  });
});
