import * as cheerio from 'cheerio';
import { ILocationOption, IProviderConfig } from '../../interfaces/isearch/isearch.interface';
import { ScrapedPost } from '../../interfaces/ScrapedPost/iscrapedpost.interface';
import { mergeProviderOverrides } from '../../utils/provider';
import { collapseSpaces } from '../../utils/text';

export interface RemotiveJobItem {
  id?: number;
  url?: string;
  title?: string;
  company_name?: string;
  category?: string;
  tags?: string[];
  candidate_required_location?: string;
  description?: string;
}

const NON_TECH_CATEGORY_RE = /\b(marketing|sales|customer service|writing|finance|legal|hr|human resources|medical)\b/i;

export function parseRemotiveJobsPayload(
  payload: unknown,
  locationLabel?: string,
): ScrapedPost[] {
  const jobs = Array.isArray((payload as { jobs?: unknown })?.jobs)
    ? ((payload as { jobs: RemotiveJobItem[] }).jobs)
    : [];

  return jobs.flatMap((job) => {
    const title = job.title?.trim();
    const url = job.url?.trim();
    if (!title || !url) return [];
    if (job.category && NON_TECH_CATEGORY_RE.test(job.category)) return [];

    const company = job.company_name?.trim() || 'Empresa não informada';
    const plainDesc = job.description ? collapseSpaces(cheerio.load(job.description).text()).slice(0, 1200) : '';
    const loc = job.candidate_required_location?.trim() || locationLabel || 'Remoto';

    return [
      {
        title,
        company,
        location: loc,
        url,
        link: url,
        text: plainDesc
          ? `Vaga: ${title} | Empresa: ${company}\n${plainDesc}`
          : `Vaga: ${title} | Empresa: ${company}`,
      },
    ];
  });
}

export const remotiveProvider: IProviderConfig = {
  name: 'remotive',
  supportsLocation: (location?: ILocationOption) => Boolean(location?.workplaceTypes?.includes('remote')),
  buildSearchUrl: (query: string) =>
    `https://remotive.com/api/remote-jobs?category=software-dev&search=${encodeURIComponent(query.trim())}&limit=25`,
  selectors: {
    container: '',
    jobTitle: '',
    companyName: '',
    jobLink: '',
    waitSelector: 'body',
    baseUrl: 'https://remotive.com',
  },
  fetchJobs: async (query: string, location?: ILocationOption): Promise<ScrapedPost[]> => {
    const url = remotiveProvider.buildSearchUrl(query, location);
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'LioApply-JobBot/0.2' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Remotive API HTTP ${res.status}`);
    return parseRemotiveJobsPayload(await res.json(), location?.label);
  },
};

export function remotive(overrides?: Partial<IProviderConfig>): IProviderConfig {
  return mergeProviderOverrides(remotiveProvider, overrides);
}

export const createRemotiveProvider = remotive;
