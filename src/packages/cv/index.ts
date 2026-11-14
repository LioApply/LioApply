import { DynamicModule, Module } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { JobConfigService } from '../../config/job-config.service';
import { JevService } from '../../services/jev/jev.service';
import { CvLlmService } from '../../services/cv/cv-llm.service';
import { TypstTemplateService } from '../../services/cv/typst-template.service';
import { TypstCompilerService } from '../../services/cv/typst-compiler.service';
import {
  CvOptimizationResult,
  CvOptimizationService,
} from '../../services/cv/cv-optimization.service';
import {
  BaseCvData,
  CvOptimizationConfig,
  CvTailoredPatchDto,
  TailoredCvEvaluation,
} from '../../interfaces/cv/cv.interface';

export interface CvEngineOptions {
  /** Path to `cv.base.yaml` OR inline `BaseCvData` object. */
  baseCv?: string | BaseCvData;
  /** Alias for `baseCv` path. */
  baseCvPath?: string;
  /** LLM API key (e.g. OpenRouter). */
  apiKey?: string;
  /** Alias for `apiKey`. */
  openRouterApiKey?: string;
  /** Model identifier (default: `openrouter/free`). */
  model?: string;
  /** Alias for `model`. */
  openRouterModel?: string;
  /** Default directory when saving PDFs to disk. */
  outputDir?: string;
}

export interface StandaloneCvOptimizationResult extends CvOptimizationResult {
  savedFilePath?: string;
}

/**
 * Pure SDK Factory (`@lioapply/cv`): Creates a standalone ATS CV optimization engine
 * that can be injected into `createLioApply({ cv: typstCvEngine(...) })` or used standalone.
 */
export function typstCvEngine(options?: CvEngineOptions) {
  const apiKey = options?.apiKey || options?.openRouterApiKey;
  const model = options?.model || options?.openRouterModel;
  const inlineBaseCv =
    options?.baseCv && typeof options.baseCv === 'object'
      ? options.baseCv
      : undefined;
  const baseCvPath =
    typeof options?.baseCv === 'string' ? options.baseCv : options?.baseCvPath;

  if (apiKey) {
    process.env.OPEN_ROUTER_API_KEY = apiKey;
  }
  if (model) {
    process.env.OPENROUTER_MODEL = model;
  }
  if (baseCvPath) {
    process.env.CV_BASE_PATH = baseCvPath;
  }

  const configService = new JobConfigService();
  try {
    configService.loadConfig();
  } catch {
    // Config YAML is optional when using CvEngine standalone
  }

  const jevService = new JevService(configService);
  jevService.initializeProvider();

  const llmService = new CvLlmService(configService);
  const templateService = new TypstTemplateService();
  const compilerService = new TypstCompilerService();

  return {
    getBaseCv(): BaseCvData {
      return inlineBaseCv || configService.getBaseCv();
    },

    async optimizeForJob(jobInfo: {
      title: string;
      company?: string;
      description: string;
      outputPath?: string;
    }): Promise<StandaloneCvOptimizationResult> {
      const baseCv = this.getBaseCv();
      const patch = await llmService.generateTailoredCvPatch(baseCv, {
        title: jobInfo.title,
        company: jobInfo.company,
        description: jobInfo.description,
      });

      const evaluation = await jevService.evaluateTailoredCv(
        baseCv,
        patch,
        jobInfo,
      );

      const tailoredCv = templateService.mergeBaseWithPatch(baseCv, patch);
      const typstSource = templateService.renderTypstDocument(tailoredCv, {
        title: jobInfo.title,
        company: jobInfo.company,
      });

      const pdfBuffer = await compilerService.compileToPdfBuffer(typstSource);

      const safeName = (baseCv.name || 'Candidato')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .substring(0, 35);
      const safeTarget = (jobInfo.company || jobInfo.title || 'Vaga')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .substring(0, 35);
      const fileName = `Curriculo_${safeName}_${safeTarget}.pdf`;

      let savedFilePath: string | undefined;
      const targetOutput =
        jobInfo.outputPath ||
        (options?.outputDir
          ? path.resolve(options.outputDir, fileName)
          : undefined);

      if (targetOutput) {
        fs.mkdirSync(path.dirname(targetOutput), { recursive: true });
        fs.writeFileSync(targetOutput, pdfBuffer);
        savedFilePath = targetOutput;
      }

      return {
        pdfBuffer,
        fileName,
        evaluation,
        tailoredCv,
        savedFilePath,
      };
    },

    renderTypst(
      cvData: BaseCvData,
      targetJob?: { title?: string; company?: string },
    ): string {
      return templateService.renderTypstDocument(cvData, targetJob);
    },

    async compilePdf(typstSource: string): Promise<Buffer> {
      return compilerService.compileToPdfBuffer(typstSource);
    },
  };
}

export const createCvEngine = typstCvEngine;

@Module({})
export class LioApplyCvModule {
  static register(): DynamicModule {
    return {
      module: LioApplyCvModule,
      providers: [
        CvLlmService,
        TypstTemplateService,
        TypstCompilerService,
      ],
      exports: [
        CvLlmService,
        TypstTemplateService,
        TypstCompilerService,
      ],
    };
  }
}

export {
  CvOptimizationService,
  CvLlmService,
  TypstTemplateService,
  TypstCompilerService,
};

export type {
  CvOptimizationResult,
  BaseCvData,
  CvOptimizationConfig,
  CvTailoredPatchDto,
  TailoredCvEvaluation,
};
