import { DynamicModule, Module } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { BaseCvData, CvLlmProviderType, CvOptimizationConfig, CvTailoredPatchDto, TailoredCvEvaluation, CvOptimizationResult } from '../../interfaces/cv/cv.interface';
import { createClassifierService } from '../../services/classifier/classifier.service';
import { CvConfigService } from '../../services/cv/cv-config.service';
import { CvLlmService } from '../../services/cv/cv-llm.service';
import { CvOptimizationService } from '../../services/cv/cv-optimization.service';
import { TypstCompilerService } from '../../services/cv/typst-compiler.service';
import { TypstTemplateService } from '../../services/cv/typst-template.service';
import { detectJobLanguage } from '../../utils/language';
import { buildSafePdfFileName } from '../../utils/cv';

export interface CvEngineOptions {
  baseCv?: string | BaseCvData;
  baseCvPath?: string;
  provider?: CvLlmProviderType;
  apiKey?: string;
  openRouterApiKey?: string;
  model?: string;
  openRouterModel?: string;
  baseUrl?: string;
  outputDir?: string;
}

export interface StandaloneCvOptimizationResult extends CvOptimizationResult {
  savedFilePath?: string;
}

/** Pure SDK Factory (`@lioapply/cv`): Standalone ATS CV optimization engine. */
export function typstCvEngine(options?: CvEngineOptions) {
  const apiKey = options?.apiKey || options?.openRouterApiKey;
  const model = options?.model || options?.openRouterModel;
  const inlineBaseCv = options?.baseCv && typeof options.baseCv === 'object' ? options.baseCv : undefined;
  const baseCvPath = typeof options?.baseCv === 'string' ? options.baseCv : options?.baseCvPath;

  if (options?.provider && options.provider !== 'auto') process.env.CV_PROVIDER = options.provider;
  if (apiKey) {
    process.env.CV_API_KEY = apiKey;
    if (options?.openRouterApiKey) process.env.OPEN_ROUTER_API_KEY = options.openRouterApiKey;
  }
  if (model) process.env.CV_MODEL = model;
  if (options?.baseUrl) process.env.CV_BASE_URL = options.baseUrl;
  if (baseCvPath) process.env.CV_BASE_PATH = baseCvPath;

  const cvConfigService = new CvConfigService();
  const classifierService = createClassifierService(undefined, {
    ...(options?.provider && options.provider !== 'auto' ? { provider: options.provider as any } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(model ? { model } : {}),
    ...(options?.baseUrl ? { baseUrl: options.baseUrl } : {}),
  });
  const llmService = new CvLlmService(cvConfigService);
  const templateService = new TypstTemplateService();
  const compilerService = new TypstCompilerService();

  return {
    getBaseCv: (): BaseCvData => inlineBaseCv || cvConfigService.getBaseCv(),

    async optimizeForJob(jobInfo: {
      title: string;
      company?: string;
      description: string;
      outputPath?: string;
    }): Promise<StandaloneCvOptimizationResult> {
      const baseCv = this.getBaseCv();
      const patch = await llmService.generateTailoredCvPatch(baseCv, jobInfo);
      const evaluation = await classifierService.evaluateTailoredCv(baseCv, patch, jobInfo);
      const targetLanguage = detectJobLanguage(`${jobInfo.title}\n${jobInfo.description}`);
      const tailoredCv = templateService.mergeBaseWithPatch(baseCv, patch, targetLanguage);
      const pdfBuffer = await compilerService.compileToPdfBuffer(
        templateService.renderTypstDocument(tailoredCv, { ...jobInfo, language: targetLanguage }),
      );
      const fileName = buildSafePdfFileName(baseCv.name, jobInfo.company || jobInfo.title);

      let targetOutput: string | undefined;
      if (jobInfo.outputPath) {
        const allowedBase = path.resolve(options?.outputDir || process.cwd());
        const resolvedTarget = path.resolve(allowedBase, jobInfo.outputPath);
        const rel = path.relative(allowedBase, resolvedTarget);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
          throw new Error(`Caminho outputPath inválido (fora do diretório permitido): ${jobInfo.outputPath}`);
        }
        targetOutput = resolvedTarget;
      } else if (options?.outputDir) {
        targetOutput = path.resolve(options.outputDir, fileName);
      }

      if (targetOutput) {
        fs.mkdirSync(path.dirname(targetOutput), { recursive: true });
        fs.writeFileSync(targetOutput, pdfBuffer);
      }

      return { pdfBuffer, fileName, evaluation, tailoredCv, savedFilePath: targetOutput };
    },

    renderTypst: (cvData: BaseCvData, targetJob?: { title?: string; company?: string }): string =>
      templateService.renderTypstDocument(cvData, targetJob),

    compilePdf: (typstSource: string): Promise<Buffer> => compilerService.compileToPdfBuffer(typstSource),
  };
}

export const createCvEngine = typstCvEngine;

@Module({})
export class LioApplyCvModule {
  static register(): DynamicModule {
    const providers = [CvConfigService, CvLlmService, TypstTemplateService, TypstCompilerService];
    return { module: LioApplyCvModule, providers, exports: providers };
  }
}

export { JobPageMetadataService } from '../../services/cv/job-page-metadata.service';
export { CvConfigService, CvOptimizationService, CvLlmService, TypstTemplateService, TypstCompilerService };
export type {
  CvOptimizationResult,
  BaseCvData,
  CvLlmProviderType,
  CvOptimizationConfig,
  CvTailoredPatchDto,
  TailoredCvEvaluation,
};
