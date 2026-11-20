import { createLioApply, LioApplyCoreModule } from '@lioapply/core';
import {
  resolveProviders,
  linkedinProvider,
  glassdoorProvider,
  remotarProvider,
  parseGithubIssuesPayload,
  parseRemotiveJobsPayload,
  parseRssFeedXml,
  rssFeed,
} from '@lioapply/providers';
import { linkedin } from '@lioapply/providers/linkedin';
import { glassdoor } from '@lioapply/providers/glassdoor';
import { remotar } from '@lioapply/providers/remotar';
import { indeed } from '@lioapply/providers/indeed';
import { remotive } from '@lioapply/providers/remotive';
import { githubVagas } from '@lioapply/providers/github-vagas';
import { weworkremotely } from '@lioapply/providers/rss';
import { typstCvEngine, LioApplyCvModule } from '@lioapply/cv';
import { createLioApplyMcpServer } from '@lioapply/mcp';

describe('LioApply Injectable Packages (@lioapply/*)', () => {
  describe('@lioapply/providers & subpath imports', () => {
    it('supports subpath factory imports (@lioapply/providers/<provider>)', () => {
      const customLinkedin = linkedin({ name: 'linkedin-custom' });
      const customGlassdoor = glassdoor();
      const customRemotar = remotar();

      expect(customLinkedin.name).toBe('linkedin-custom');
      expect(customGlassdoor.name).toBe('glassdoor');
      expect(customRemotar.name).toBe('remotar');
    });

    it('resolves provider names and custom objects into IProviderConfig instances', () => {
      const resolved = resolveProviders(['linkedin', 'remotar']);
      expect(resolved).toEqual([linkedinProvider, remotarProvider]);

      const fallback = resolveProviders([]);
      expect(fallback).toEqual([
        glassdoorProvider,
        linkedinProvider,
        remotarProvider,
      ]);
    });
  });

  describe('@lioapply/core (createLioApply & LioApplyCoreModule)', () => {
    it('creates a LioApply SDK instance with declarative providers, profile path, and injected cv plugin', () => {
      const cvPlugin = typstCvEngine({ baseCv: './cv.base.example.yaml' });
      const lio = createLioApply({
        providers: [linkedin(), glassdoor()],
        classifier: { provider: 'openrouter', apiKey: 'test-key' },
        profile: './jobs.config.yaml',
        cv: cvPlugin,
      });

      expect(lio.getProviders().map((p) => p.name)).toEqual([
        'linkedin',
        'glassdoor',
      ]);
      expect(lio.cv).toBe(cvPlugin);

      const rubric = lio.buildSystemOneClassificationState([
        {
          title: 'Desenvolvedor Full Stack Pleno',
          company: 'Acme',
          text: 'Vaga Node.js e React remoto',
          url: 'https://example.com/job/1',
        },
      ]);

      expect(rubric.state.job_candidates).toHaveLength(1);
      expect(rubric.questions.matches_profile.type).toBe('noul');
      expect(rubric.questions.is_actual_job_offer.type).toBe('noul');
    });

    it('exposes LioApplyCoreModule.register() DynamicModule for NestJS DI', () => {
      const dynamicMod = LioApplyCoreModule.register({
        providers: ['remotar'],
      });
      expect(dynamicMod.module).toBe(LioApplyCoreModule);
      expect(dynamicMod.exports).toContain('LIOAPPLY_PROVIDERS');
    });
  });

  describe('@lioapply/cv (typstCvEngine & LioApplyCvModule)', () => {
    it('creates standalone CV engine capable of rendering Typst documents', () => {
      const cv = typstCvEngine();
      const baseCv = cv.getBaseCv();
      const typstDoc = cv.renderTypst(baseCv, {
        title: 'Engenheiro de Software Pleno',
        company: 'LioApply',
      });

      expect(typstDoc).toContain('#set page');
      expect(LioApplyCvModule.register().module).toBe(LioApplyCvModule);
    });
  });

  describe('@lioapply/mcp (Official MCP Server)', () => {
    it('handles JSON-RPC initialize, tools/list, and tools/call (lioapply_get_classification_rubric)', async () => {
      const mcp = createLioApplyMcpServer({
        providers: ['linkedin'],
      });

      const initRes = await mcp.handleJsonRpcRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
      });
      expect(initRes?.result).toEqual(
        expect.objectContaining({
          serverInfo: { name: '@lioapply/mcp', version: '0.1.0' },
        }),
      );

      const toolsRes = await mcp.handleJsonRpcRequest({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      });
      const toolNames = (toolsRes?.result as any).tools.map((t: any) => t.name);
      expect(toolNames).toEqual([
        'lioapply_search_jobs',
        'lioapply_get_classification_rubric',
        'lioapply_classify_jobs',
        'lioapply_optimize_cv',
      ]);

      const callRes = await mcp.handleJsonRpcRequest({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'lioapply_get_classification_rubric',
          arguments: {
            candidates: [
              {
                title: 'Backend Developer Pleno',
                company: 'Tech Co',
                text: 'Node.js, TypeScript, NestJS',
                url: 'https://example.com/1',
              },
            ],
          },
        },
      });

      const contentText = (callRes?.result as any).content[0].text;
      const parsedRubric = JSON.parse(contentText);
      expect(parsedRubric.state.job_candidates[0].title).toBe(
        'Backend Developer Pleno',
      );
    });

    it('builds dynamic Glassdoor search URLs and rejects invalid JSON-RPC payloads', async () => {
      const gd = glassdoor();
      const urlWithLoc = gd.buildSearchUrl('NodeJS', { label: 'Brasil', locationQuery: 'brasil', workplaceTypes: ['remote'], providerParams: { glassdoorLocationId: '36' } });
      expect(urlWithLoc).toContain('SRCH_IL.0,6_IC36.htm');

      const urlNoLoc = gd.buildSearchUrl('NodeJS', { label: 'Remoto', workplaceTypes: ['remote'] });
      expect(urlNoLoc).toContain('SRCH_KO0,6.htm');

      const mcp = createLioApplyMcpServer();
      const invalidReq = await mcp.handleJsonRpcRequest(null as any);
      expect(invalidReq).toEqual({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Invalid Request' },
      });
    });

    it('resolves new pluggable providers (#30) and parses JSON/RSS feeds without Playwright', async () => {
      const resolved = resolveProviders(['indeed', 'remotive', 'github-vagas', 'weworkremotely']);
      expect(resolved.map((p) => p.name)).toEqual(['indeed', 'remotive', 'github-vagas', 'weworkremotely']);

      expect(
        indeed().buildSearchUrl('Node.js Developer', {
          label: 'Remoto',
          workplaceTypes: ['remote'],
        }),
      ).toContain('https://br.indeed.com/jobs?q=Node.js%20Developer&l=Remoto');

      expect(remotive().buildSearchUrl('TypeScript')).toBe(
        'https://remotive.com/api/remote-jobs?category=software-dev&search=TypeScript&limit=25',
      );
      expect(githubVagas().buildSearchUrl('NestJS')).toContain('https://api.github.com/search/issues?q=');
      expect(weworkremotely().buildSearchUrl('React')).toBe(
        'https://weworkremotely.com/remote-jobs/search.rss?term=React',
      );

      const remotivePosts = parseRemotiveJobsPayload(
        {
          jobs: [
            {
              title: 'Full Stack Engineer (Node/React)',
              company_name: 'Acme Global',
              url: 'https://remotive.com/remote-jobs/software-dev/full-stack-1',
              candidate_required_location: 'LATAM',
              description: '<p>Looking for a <b>Node.js</b> and React engineer.</p>',
            },
          ],
        },
        'Remoto',
      );
      expect(remotivePosts).toHaveLength(1);
      expect(remotivePosts[0]).toMatchObject({
        title: 'Full Stack Engineer (Node/React)',
        company: 'Acme Global',
        location: 'LATAM',
        url: 'https://remotive.com/remote-jobs/software-dev/full-stack-1',
      });
      expect(remotivePosts[0].text).toContain('Looking for a Node.js and React engineer.');

      const ghPosts = parseGithubIssuesPayload(
        {
          items: [
            {
              title: '[Remoto] Desenvolvedor Backend Node.js Pleno na TechBrasil',
              html_url: 'https://github.com/backend-br/vagas/issues/9999',
              labels: [{ name: 'Remoto' }, { name: 'Pleno' }],
              body: 'Atuação 100% remota com Node.js, NestJS e PostgreSQL.',
            },
          ],
        },
        'Remoto (Brasil)',
      );
      expect(ghPosts).toHaveLength(1);
      expect(ghPosts[0]).toMatchObject({
        title: 'Desenvolvedor Backend Node.js Pleno',
        company: 'TechBrasil',
        url: 'https://github.com/backend-br/vagas/issues/9999',
      });

      const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0"><channel>
          <item>
            <title>CloudCorp: Backend Node.js Developer</title>
            <link>https://weworkremotely.com/remote-jobs/cloudcorp-backend</link>
            <description><![CDATA[<p>Remote Node.js TypeScript position.</p>]]></description>
          </item>
          <item>
            <title>OtherCo: iOS Swift Engineer</title>
            <link>https://weworkremotely.com/remote-jobs/otherco-ios</link>
            <description>Swift mobile role</description>
          </item>
        </channel></rss>`;
      const rssPosts = parseRssFeedXml(rssXml, { query: 'Node.js', locationLabel: 'Remoto' });
      expect(rssPosts).toHaveLength(1);
      expect(rssPosts[0]).toMatchObject({
        title: 'Backend Node.js Developer',
        company: 'CloudCorp',
        url: 'https://weworkremotely.com/remote-jobs/cloudcorp-backend',
      });

      const customRss = rssFeed({
        name: 'custom-rss',
        buildFeedUrl: () => 'https://example.com/feed.xml',
      });
      expect(typeof customRss.fetchJobs).toBe('function');
    });
  });
});
