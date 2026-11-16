import { Injectable, Logger, Optional } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { JobConfigService } from '../../config/job-config.service';
import {
  findExistingFile,
  parseYamlObject,
} from '../../config/yaml-config.loader';
import { BaseCvData, CvOptimizationConfig } from '../../interfaces/cv/cv.interface';

@Injectable()
export class CvConfigService {
  private readonly logger = new Logger(CvConfigService.name);
  private cachedBaseCv: BaseCvData | null = null;

  constructor(
    @Optional() private readonly jobConfigService?: JobConfigService,
) {}

  getCvOptimizationConfig(): CvOptimizationConfig {
    let yamlCv: Partial<CvOptimizationConfig> | undefined;
    try {
      yamlCv = this.jobConfigService?.getConfig?.()?.cvOptimization;
    } catch {
      yamlCv = undefined;
    }

    return {
      provider: yamlCv?.provider || 'auto',
      model: yamlCv?.model,
      baseUrl: yamlCv?.baseUrl,
      baseCvPath: process.env.CV_BASE_PATH || yamlCv?.baseCvPath || path.resolve(process.cwd(), 'cv.base.yaml'),
    };
  }

  getBaseCv(): BaseCvData {
    if (this.cachedBaseCv) return this.cachedBaseCv;
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
