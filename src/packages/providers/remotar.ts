import {
  ILocationOption,
  IProviderConfig,
} from '../../interfaces/isearch/isearch.interface';
import { mergeProviderOverrides } from '../../utils/provider';

export const remotarProvider: IProviderConfig = {
  name: 'remotar',
  supportsLocation: (location?: ILocationOption) =>
    Boolean(location?.workplaceTypes?.includes('remote')),
  buildSearchUrl: (query: string) =>
    `https://remotar.com.br/search/jobs?q=${encodeURIComponent(query)}&c=13&t=4&t=17&t=21`,
  selectors: {
    container: '[class="box-content"]',
    jobTitle: 'a.job-title',
    companyName: 'a.company',
    jobLink: 'a.job-title',
    waitSelector: 'main',
    baseUrl: 'https://remotar.com.br',
  },
};

export function remotar(overrides?: Partial<IProviderConfig>): IProviderConfig {
  return mergeProviderOverrides(remotarProvider, overrides);
}

export const createRemotarProvider = remotar;
