import {
  ILocationOption,
  IProviderConfig,
} from '../../interfaces/isearch/isearch.interface';
import { mergeProviderOverrides } from '../../utils/provider';

export const linkedinProvider: IProviderConfig = {
  name: 'linkedin',
  buildSearchUrl: (query: string, location?: ILocationOption) => {
    const locQuery = location?.locationQuery || 'brasil';
    const geoId = location?.providerParams?.linkedinGeoId || '106057199';
    return `https://www.linkedin.com/jobs/search?keywords=${encodeURIComponent(query)}&location=${encodeURIComponent(locQuery)}&geoId=${geoId}&f_TPR=r3600&position=1&pageNum=0`;
  },
  selectors: {
    container: 'li',
    jobTitle: 'h3.base-search-card__title',
    companyName: 'h4.base-search-card__subtitle',
    jobLink: 'a.base-card__full-link',
    waitSelector: 'li',
    baseUrl: 'https://www.linkedin.com',
  },
};

export function linkedin(
  overrides?: Partial<IProviderConfig>,
): IProviderConfig {
  return mergeProviderOverrides(linkedinProvider, overrides);
}

export const createLinkedinProvider = linkedin;
