import { Injectable, Optional } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { JobConfigService } from '../../config/job-config.service';
import { BaseCvData, CvOptimizationConfig } from '../../interfaces/cv/cv.interface';
import { findExistingFile, parseYamlObject } from '../../utils/yaml';

@Injectable()
export class CvConfigService {
  private cachedBaseCv: BaseCvData | null = null;
  private cachedBaseCvPath: string | null = null;

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

    const envProvider = process.env.CV_PROVIDER?.trim() as CvOptimizationConfig['provider'] | undefined;

    return {
      provider: envProvider || yamlCv?.provider || 'auto',
      model: process.env.CV_MODEL?.trim() || yamlCv?.model,
      baseUrl: process.env.CV_BASE_URL?.trim() || yamlCv?.baseUrl,
      baseCvPath: process.env.CV_BASE_PATH || yamlCv?.baseCvPath || path.resolve(process.cwd(), 'cv.base.yaml'),
    };
  }

  getBaseCv(): BaseCvData {
    const { baseCvPath } = this.getCvOptimizationConfig();
    const resolvedBase = path.isAbsolute(baseCvPath) ? baseCvPath : path.resolve(process.cwd(), baseCvPath);
    if (this.cachedBaseCv && this.cachedBaseCvPath === resolvedBase) return this.cachedBaseCv;

    const cvPath = findExistingFile([
      resolvedBase,
      path.resolve(process.cwd(), 'cv.base.yaml'),
      path.resolve(process.cwd(), 'cv.base.example.yaml'),
      '/usr/src/app/cv.base.yaml',
    ]);

    const parsed = cvPath ? parseYamlObject<BaseCvData>(fs.readFileSync(cvPath, 'utf8')) : undefined;
    if (parsed?.name) {
      this.cachedBaseCvPath = resolvedBase;
      return (this.cachedBaseCv = parsed);
    }

    throw new Error(
      "Currículo base não encontrado: crie o arquivo 'cv.base.yaml' na raiz do projeto ou defina CV_BASE_PATH no ambiente.",
    );
  }
}
