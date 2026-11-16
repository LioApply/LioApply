import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as path from 'path';
import { ILocationOption, IProviderConfig } from '../interfaces/isearch/isearch.interface';
import { AppJobConfig } from '../interfaces/job-config/job-config.interface';
import { resolveProviders } from '../packages/providers';
import { ClassifierProviderConfig } from '../services/classifier/classifier-clients';
import { UserProfileCriteria } from '../utils/jev';
import { arr, csv, loadYamlFromFile } from './yaml-config.loader';

@Injectable()
export class JobConfigService implements OnModuleInit {
  private readonly logger = new Logger(JobConfigService.name);
  private config!: AppJobConfig;

  onModuleInit() {
    this.loadConfig();
  }

  loadConfig(): AppJobConfig {
    const candidates = [
      path.resolve(process.cwd(), 'jobs.config.yaml'),
      path.resolve(process.cwd(), 'jobs.config.yml'),
      '/usr/src/app/jobs.config.yaml',
    ];
    const res = loadYamlFromFile<Record<string, string>>(candidates, (p, err) =>
      this.logger.error(`Erro ao ler/parsear arquivo de configuração em ${p}: ${err.message}`),
    );
    if (!res) {
      throw new Error(
        "Configuração ausente: Forneça a variável JOBS_CONFIG_YAML (ou SEARCH_QUERIES) no ambiente (.env / Railway) ou crie o arquivo 'jobs.config.yaml' a partir de 'jobs.config.example.yaml'.",
      );
    }

    this.logger.log(`📄 Configuração carregada com sucesso do arquivo: ${res.source}`);
    const config = this.normalizeConfig(res.data);
    this.validateConfig(config, res.source);
    return (this.config = config);
  }

  getQueries = (): string[] => this.config.search.queries;
  getLocations = (): ILocationOption[] => this.config.search.locations;
  getConfig = (): AppJobConfig => this.config;

  getProviders(): IProviderConfig[] {
    const env = process.env.SEARCH_PROVIDERS ? csv(process.env.SEARCH_PROVIDERS) : undefined;
    return resolveProviders(env || this.config?.search?.providers);
  }

  getUserProfile(): UserProfileCriteria {
    const p = this.config.profile;
    return {
      targetRoles: p?.targetRoles || [],
      targetTechnologies: p?.targetTechnologies || [],
      acceptableLevels: p?.acceptableLevels || [],
      excludedLevels: p?.excludedLevels || [],
      locations: p?.locations || [],
    };
  }

  getClassifierConfig(): Partial<ClassifierProviderConfig> {
    const c = this.config?.classifier;
    return { provider: c?.provider || 'auto', model: c?.model, baseUrl: c?.baseUrl };
  }

  private validateConfig(config: AppJobConfig, source: string) {
    if (!config.search?.queries?.length) {
      throw new Error(`Configuração inválida em ${source}: 'search.queries' deve conter pelo menos uma query de busca.`);
    }
    if (!config.search?.locations?.length) {
      throw new Error(`Configuração inválida em ${source}: 'search.locations' deve conter pelo menos uma localização/provedor.`);
    }
  }

  private normalizeConfig(raw: Record<string, string>): AppJobConfig {
    const asObj = <T>(val: unknown): T =>
      (val && typeof val === 'object' && !Array.isArray(val) ? val : {}) as T;
    const search = asObj<Record<string, unknown>>(raw?.search);
    return {
      search: {
        queries: arr<string>(search.queries).map((q) => String(q).trim()).filter(Boolean),
        locations: arr<ILocationOption>(search.locations),
        providers: Array.isArray(search.providers)
          ? search.providers.map((x: string) => String(x).trim()).filter(Boolean)
          : undefined,
      },
      profile: asObj<AppJobConfig['profile']>(raw?.profile),
      classifier: asObj<AppJobConfig['classifier']>(raw?.classifier),
      cvOptimization: asObj<AppJobConfig['cvOptimization']>(raw?.cvOptimization),
    };
  }
}
