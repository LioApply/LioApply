import {
  ILocationOption,
  IProviderConfig,
} from '../../interfaces/isearch/isearch.interface';
import { mergeProviderOverrides } from '../../utils/provider';

export const glassdoorProvider: IProviderConfig = {
  name: 'glassdoor',
  buildSearchUrl: (query: string, location?: ILocationOption) => {
    const locId =
      location?.providerParams?.glassdoorLocationId ||
      location?.providerParams?.glassdoorGeoId;
    const icPart = locId ? `_IC${locId}` : '';
    const locSlug = location?.locationQuery ? location.locationQuery.trim().replace(/\s+/g, '-') : '';
    const locPart = locSlug ? `${locSlug}-` : '';
    const rawQuerySlug = query.trim().toLowerCase().replace(/\s+/g, '-');
    const cleanQuery = encodeURIComponent(rawQuerySlug);

    if (locSlug) {
      return `https://www.glassdoor.com.br/Vaga/${locPart}${cleanQuery}-vagas-SRCH_IL.0,${locSlug.length}${icPart}.htm`;
    }
    return `https://www.glassdoor.com.br/Vaga/${cleanQuery}-vagas-SRCH_KO0,${rawQuerySlug.length}${icPart}.htm`;
  },
  selectors: {
    container:
      '[data-test="jobListing"], li[class*="JobsList_jobListItem"], div[class*="JobCard_jobCardContainer"], article, [class*="JobCard"]',
    jobTitle:
      '[data-test="job-title"], a[data-test="job-link"], a[class*="JobCard_jobTitle"], a[class*="JobTitle"], [class*="job-title"]',
    companyName:
      '[class*="EmployerProfile_compactEmployerName"], [class*="EmployerProfile"], [class*="EmployerName"], [data-test="employer-name"]',
    jobLink:
      'a[data-test="job-title"], a[data-test="job-link"], a[class*="JobCard_jobTitle"], a[class*="JobTitle"], a[href*="/job-listing/"]',
    waitSelector:
      '[data-test="jobListing"], li[class*="JobsList_jobListItem"], div[class*="JobCard_jobCardContainer"], article, [class*="JobsList"], [class*="JobCard"], a[href*="/job-listing/"]',
    baseUrl: 'https://www.glassdoor.com.br',
  },
};

export function glassdoor(
  overrides?: Partial<IProviderConfig>,
): IProviderConfig {
  return mergeProviderOverrides(glassdoorProvider, overrides);
}

export const createGlassdoorProvider = glassdoor;
