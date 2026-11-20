import { ILocationOption, IProviderConfig } from '../../interfaces/isearch/isearch.interface';
import { LinkedinApifyService } from '../../services/Linkedin/linkedin-apify.service';
import { PlaywrightService } from '../../services/playWrightService/scrapservice.service';
import { createGithubVagasProvider, githubVagas, githubVagasProvider, parseGithubIssuesPayload } from './github-vagas';
import { createGlassdoorProvider, glassdoor, glassdoorProvider } from './glassdoor';
import { createIndeedProvider, indeed, indeedProvider } from './indeed';
import { createLinkedinProvider, linkedin, linkedinProvider } from './linkedin';
import { createRemotarProvider, remotar, remotarProvider } from './remotar';
import { createRemotiveProvider, parseRemotiveJobsPayload, remotive, remotiveProvider } from './remotive';
import { createWeworkremotelyProvider, parseRssFeedXml, rssFeed, weworkremotely, weworkremotelyProvider } from './rss';

export type BuiltinProviderName =
  | 'linkedin'
  | 'glassdoor'
  | 'remotar'
  | 'indeed'
  | 'remotive'
  | 'github-vagas'
  | 'weworkremotely';

export const PROVIDER_REGISTRY: Record<BuiltinProviderName, IProviderConfig> = {
  linkedin: linkedinProvider,
  glassdoor: glassdoorProvider,
  remotar: remotarProvider,
  indeed: indeedProvider,
  remotive: remotiveProvider,
  'github-vagas': githubVagasProvider,
  weworkremotely: weworkremotelyProvider,
};

export const DEFAULT_WEB_PROVIDERS: IProviderConfig[] = [
  glassdoorProvider,
  linkedinProvider,
  remotarProvider,
];

export function resolveLocationPreset(rawLocation: string): ILocationOption {
  const normalized = rawLocation.trim().toLowerCase();
  return {
    label: normalized,
    workplaceTypes: ['remote', 'onsite', 'hybrid'],
    locationQuery: normalized.replace(/\s+/g, '-'),
  };
}

export function resolveProviders(
  inputs?: Array<BuiltinProviderName | string | IProviderConfig>,
): IProviderConfig[] {
  if (!inputs?.length) return [...DEFAULT_WEB_PROVIDERS];

  const resolved = inputs.flatMap((item) => {
    if (typeof item === 'string') {
      const found = PROVIDER_REGISTRY[item.trim().toLowerCase() as BuiltinProviderName];
      return found ? [found] : [];
    }
    return item && typeof item === 'object' && 'name' in item ? [item] : [];
  });

  return resolved.length > 0 ? resolved : [...DEFAULT_WEB_PROVIDERS];
}

export {
  linkedin,
  linkedinProvider,
  createLinkedinProvider,
  glassdoor,
  glassdoorProvider,
  createGlassdoorProvider,
  remotar,
  remotarProvider,
  createRemotarProvider,
  indeed,
  indeedProvider,
  createIndeedProvider,
  remotive,
  remotiveProvider,
  createRemotiveProvider,
  parseRemotiveJobsPayload,
  githubVagas,
  githubVagasProvider,
  createGithubVagasProvider,
  parseGithubIssuesPayload,
  rssFeed,
  parseRssFeedXml,
  weworkremotely,
  weworkremotelyProvider,
  createWeworkremotelyProvider,
  PlaywrightService,
  LinkedinApifyService,
};
