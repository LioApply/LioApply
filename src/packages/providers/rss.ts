import * as cheerio from 'cheerio';
import { ILocationOption, IProviderConfig } from '../../interfaces/isearch/isearch.interface';
import { ScrapedPost } from '../../interfaces/ScrapedPost/iscrapedpost.interface';
import { mergeProviderOverrides } from '../../utils/provider';
import { collapseSpaces } from '../../utils/text';

export interface RssFeedProviderOptions {
  name?: string;
  buildFeedUrl: (query: string, location?: ILocationOption) => string;
  supportsLocation?: (location: ILocationOption) => boolean;
  defaultCompany?: string;
}

export function parseRssFeedXml(
  xml: string,
  options?: { query?: string; locationLabel?: string; defaultCompany?: string },
): ScrapedPost[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  const posts: ScrapedPost[] = [];
  const queryTerms = (options?.query || '')
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);

  $('item, entry').each((_, el) => {
    const rawTitle = $(el).find('title').first().text().trim();
    const link =
      $(el).find('link').first().text().trim() ||
      $(el).find('link').first().attr('href')?.trim() ||
      $(el).find('guid').first().text().trim() ||
      '';
    const rawDesc =
      $(el).find('description, summary, content, content\\:encoded').first().text().trim() || '';

    if (!rawTitle || !link) return;

    const plainDesc = rawDesc ? collapseSpaces(cheerio.load(rawDesc).text()).slice(0, 1200) : '';
    const searchable = `${rawTitle} ${plainDesc}`.toLowerCase();
    if (queryTerms.length > 0 && !queryTerms.some((term) => searchable.includes(term))) {
      return;
    }

    const colonSplit = rawTitle.match(/^([^:]{2,45}):\s+(.+)$/);
    const company = colonSplit?.[1]?.trim() || options?.defaultCompany || 'Empresa não informada';
    const title = colonSplit?.[2]?.trim() || rawTitle;

    posts.push({
      title,
      company,
      location: options?.locationLabel || 'Remoto',
      url: link,
      link,
      text: plainDesc
        ? `Vaga: ${title} | Empresa: ${company}\n${plainDesc}`
        : `Vaga: ${title} | Empresa: ${company}`,
    });
  });

  return posts;
}

export function rssFeed(options: RssFeedProviderOptions): IProviderConfig {
  const providerName = options.name || 'rss';
  return {
    name: providerName,
    supportsLocation:
      options.supportsLocation || ((location?: ILocationOption) => Boolean(location?.workplaceTypes?.includes('remote'))),
    buildSearchUrl: options.buildFeedUrl,
    selectors: {
      container: 'item, entry',
      jobTitle: 'title',
      companyName: 'author',
      jobLink: 'link',
      waitSelector: 'rss, feed',
      baseUrl: '',
    },
    fetchJobs: async (query: string, location?: ILocationOption): Promise<ScrapedPost[]> => {
      const url = options.buildFeedUrl(query, location);
      const res = await fetch(url, {
        headers: { Accept: 'application/rss+xml, application/xml, text/xml', 'User-Agent': 'LioApply-JobBot/0.2' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`RSS Feed (${providerName}) HTTP ${res.status}`);
      const xml = await res.text();
      return parseRssFeedXml(xml, {
        query,
        locationLabel: location?.label,
        defaultCompany: options.defaultCompany,
      });
    },
  };
}

export const weworkremotelyProvider: IProviderConfig = rssFeed({
  name: 'weworkremotely',
  buildFeedUrl: (query: string) =>
    `https://weworkremotely.com/remote-jobs/search.rss?term=${encodeURIComponent(query.trim())}`,
  defaultCompany: 'WeWorkRemotely',
});

export function weworkremotely(overrides?: Partial<IProviderConfig>): IProviderConfig {
  return mergeProviderOverrides(weworkremotelyProvider, overrides);
}

export const createWeworkremotelyProvider = weworkremotely;
