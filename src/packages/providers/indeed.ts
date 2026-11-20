import { ILocationOption, IProviderConfig } from '../../interfaces/isearch/isearch.interface';
import { mergeProviderOverrides } from '../../utils/provider';

export const indeedProvider: IProviderConfig = {
  name: 'indeed',
  buildSearchUrl: (query: string, location?: ILocationOption) => {
    const isRemote = location?.workplaceTypes?.includes('remote') && location.workplaceTypes.length === 1;
    const locParam = isRemote
      ? 'Remoto'
      : location?.locationQuery?.replace(/-/g, ' ') || location?.label || 'Brasil';
    const scParam = isRemote ? '&sc=0kf%3Aattr%28DSQF7%29%3B' : '';
    return `https://br.indeed.com/jobs?q=${encodeURIComponent(query.trim())}&l=${encodeURIComponent(locParam)}&fromage=3${scParam}`;
  },
  selectors: {
    container: 'div.job_seen_beacon, div.cardOutline, td.resultContent, li.css-5lfssm',
    jobTitle: 'h2.jobTitle span[title], h2.jobTitle a, a.jcs-JobTitle',
    companyName: '[data-testid="company-name"], span.companyName',
    jobLink: 'h2.jobTitle a, a.jcs-JobTitle, a[data-jk]',
    waitSelector: 'div.job_seen_beacon, #mosaic-provider-jobcards, td.resultContent',
    baseUrl: 'https://br.indeed.com',
  },
};

export function indeed(overrides?: Partial<IProviderConfig>): IProviderConfig {
  return mergeProviderOverrides(indeedProvider, overrides);
}

export const createIndeedProvider = indeed;
