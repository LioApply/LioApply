/** Evolution API base URL (`evolutionApiUrl` or `EVOLUTION_API_URL`). */
export const getEvolutionBaseUrl = (fallback = ''): string =>
  process.env.evolutionApiUrl || process.env.EVOLUTION_API_URL || fallback;

/** Evolution API key (`apiKey` or `AUTHENTICATION_API_KEY`). */
export const getEvolutionApiKey = (): string => process.env.apiKey || process.env.AUTHENTICATION_API_KEY || '';
