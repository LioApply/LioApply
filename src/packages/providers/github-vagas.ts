import { ILocationOption, IProviderConfig } from '../../interfaces/isearch/isearch.interface';
import { ScrapedPost } from '../../interfaces/ScrapedPost/iscrapedpost.interface';
import { mergeProviderOverrides } from '../../utils/provider';
import { collapseSpaces } from '../../utils/text';

const DEFAULT_BR_REPOS = [
  'backend-br/vagas',
  'frontendbr/vagas',
  'react-brasil/vagas',
  'qa-brasil/vagas',
];

export interface GithubIssueItem {
  html_url?: string;
  title?: string;
  body?: string | null;
  labels?: Array<{ name?: string }>;
}

export function extractCompanyFromGithubTitle(rawTitle: string): { title: string; company: string } {
  const cleaned = rawTitle.replace(/^(?:\[[^\]]+\]\s*)+/, '').trim();
  const atMatch = cleaned.match(/^(.*?)\s+(?:na|no|at|@|-|–)\s+([A-ZÀ-Ú0-9][\wÀ-ÿ0-9\s.&-]{1,45})$/i);
  if (atMatch?.[1] && atMatch?.[2]) {
    return { title: atMatch[1].trim(), company: atMatch[2].trim() };
  }
  return { title: cleaned || rawTitle.trim(), company: 'GitHub Vagas' };
}

export function parseGithubIssuesPayload(payload: unknown, locationLabel?: string): ScrapedPost[] {
  const items = Array.isArray((payload as { items?: unknown })?.items)
    ? ((payload as { items: GithubIssueItem[] }).items)
    : [];

  return items.flatMap((issue) => {
    const rawTitle = issue.title?.trim();
    const url = issue.html_url?.trim();
    if (!rawTitle || !url) return [];

    const { title, company } = extractCompanyFromGithubTitle(rawTitle);
    const labels = (issue.labels || []).map((l) => l.name).filter(Boolean).join(', ');
    const bodyExcerpt = issue.body ? collapseSpaces(issue.body).slice(0, 1200) : '';
    const details = [labels ? `Tags: ${labels}` : '', bodyExcerpt].filter(Boolean).join(' — ');

    return [
      {
        title,
        company,
        location: locationLabel,
        url,
        link: url,
        text: details
          ? `Vaga: ${title} | Empresa: ${company}\n${details}`
          : `Vaga: ${title} | Empresa: ${company}`,
      },
    ];
  });
}

const GENERIC_QUERY_STOPWORDS = new Set([
  'desenvolvedor',
  'desenvolvedora',
  'developer',
  'programador',
  'programadora',
  'engenheiro',
  'engineer',
  'software',
  'vaga',
  'vagas',
  'de',
]);

export function normalizeGithubSearchQuery(rawQuery: string): string {
  const cleaned = rawQuery
    .trim()
    .replace(/\bnodejs\b/gi, 'node')
    .replace(/\breactjs\b/gi, 'react')
    .replace(/\bnextjs\b/gi, 'next')
    .replace(/\bnestjs\b/gi, 'nest');

  const terms = cleaned
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !GENERIC_QUERY_STOPWORDS.has(t.toLowerCase()));

  return terms.length > 0 ? terms.join(' ') : cleaned;
}

export const githubVagasProvider: IProviderConfig = {
  name: 'github-vagas',
  buildSearchUrl: (query: string) => {
    const repoFilter = DEFAULT_BR_REPOS.map((r) => `repo:${r}`).join(' ');
    const normalizedQuery = normalizeGithubSearchQuery(query);
    const q = `${repoFilter} is:issue is:open ${normalizedQuery}`;
    return `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&sort=created&order=desc&per_page=20`;
  },
  selectors: {
    container: '',
    jobTitle: '',
    companyName: '',
    jobLink: '',
    waitSelector: 'body',
    baseUrl: 'https://github.com',
  },
  fetchJobs: async (query: string, location?: ILocationOption): Promise<ScrapedPost[]> => {
    const url = githubVagasProvider.buildSearchUrl(query, location);
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'LioApply-JobBot/0.2',
    };
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`GitHub Issues API HTTP ${res.status}`);
    return parseGithubIssuesPayload(await res.json(), location?.label);
  },
};

export function githubVagas(overrides?: Partial<IProviderConfig>): IProviderConfig {
  return mergeProviderOverrides(githubVagasProvider, overrides);
}

export const createGithubVagasProvider = githubVagas;
