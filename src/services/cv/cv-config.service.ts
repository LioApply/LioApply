import { Injectable, Logger, Optional } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { JobConfigService } from '../../config/job-config.service';
import {
  findExistingFile,
  loadYamlFromEnv,
  parseYamlObject,
} from '../../config/yaml-config.loader';
import { BaseCvData, CvOptimizationConfig } from '../../interfaces/cv/cv.interface';

const CV_ENV_SOURCES = [
  { envKeys: ['CV_BASE_YAML'], label: 'variável CV_BASE_YAML' },
  { envKeys: ['CV_BASE_BASE64'], label: 'variável CV_BASE_BASE64', base64: true },
];

@Injectable()
export class CvConfigService {
  private readonly logger = new Logger(CvConfigService.name);
  private cachedBaseCv: BaseCvData | null = null;

  constructor(@Optional() private readonly jobConfigService?: JobConfigService) {}

  getCvOptimizationConfig(): CvOptimizationConfig {
    let yamlCv: Partial<CvOptimizationConfig> | undefined;
    try {
      yamlCv = this.jobConfigService?.getConfig?.()?.cvOptimization;
    } catch {
      yamlCv = undefined;
    }

    const openRouterModel =
      process.env.OPENROUTER_MODEL || yamlCv?.openRouterModel || 'openrouter/free';

    return {
      provider: (process.env.CV_PROVIDER as CvOptimizationConfig['provider']) || yamlCv?.provider || 'auto',
      model: process.env.CV_MODEL || yamlCv?.model || process.env.OPENROUTER_MODEL || yamlCv?.openRouterModel,
      baseUrl: process.env.CV_BASE_URL || yamlCv?.baseUrl,
      openRouterModel,
      baseCvPath: process.env.CV_BASE_PATH || yamlCv?.baseCvPath || path.resolve(process.cwd(), 'cv.base.yaml'),
    };
  }

  getBaseCv(): BaseCvData {
    if (this.cachedBaseCv) return this.cachedBaseCv;

    const fromEnv = loadYamlFromEnv<BaseCvData>(CV_ENV_SOURCES, (label, err) =>
      this.logger.warn(`Aviso: Falha ao parsear ${label} (${err.message}). Tentando arquivo em disco...`),
    );
    if (fromEnv) return (this.cachedBaseCv = fromEnv.data);

    const { baseCvPath } = this.getCvOptimizationConfig();
    const resolvedBase = path.isAbsolute(baseCvPath) ? baseCvPath : path.resolve(process.cwd(), baseCvPath);
    const cvPath = findExistingFile([
      resolvedBase,
      path.resolve(process.cwd(), 'cv.base.yaml'),
      path.resolve(process.cwd(), 'cv.base.example.yaml'),
      '/usr/src/app/cv.base.yaml',
    ]);

    const parsed = cvPath ? parseYamlObject<BaseCvData>(fs.readFileSync(cvPath, 'utf8')) : undefined;
    if (parsed?.name) return (this.cachedBaseCv = parsed);

    throw new Error(
      "Currículo base não encontrado: crie o arquivo 'cv.base.yaml' na raiz do projeto ou defina CV_BASE_YAML no ambiente.",
    );
  }
}
