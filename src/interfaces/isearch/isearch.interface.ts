export type WorkplaceType = 'remote' | 'onsite' | 'hybrid';

export interface ILocationOption {
  provider?: string;
  label: string;
  workplaceTypes: WorkplaceType[];
  locationQuery?: string;
  providerParams?: Record<string, string>;
}

export interface IProviderSelectors {
  container: string;
  jobTitle: string;
  companyName: string;
  jobLink: string;
  waitSelector: string;
  baseUrl: string;
}

export interface IProviderConfig {
  name: string;
  buildSearchUrl: (query: string, location?: ILocationOption) => string;
  supportsLocation?: (location: ILocationOption) => boolean;
  isLinkedinPosts?: boolean;
  selectors: IProviderSelectors;
  /** Optional direct HTTP/RSS/JSON fetcher that bypasses Playwright when present. */
  fetchJobs?: (query: string, location?: ILocationOption) => Promise<import('../ScrapedPost/iscrapedpost.interface').ScrapedPost[]>;
}

export interface Isearch {
  provider: IProviderConfig;
  searchQueries: string[];
  location?: ILocationOption[];
  sortBy?: 'relevance' | 'date';
}

export interface ScrapeTask {
  provider: IProviderConfig;
  query: string;
  locOption: ILocationOption;
}
