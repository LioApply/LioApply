import { INestApplicationContext, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from './app.module';
import { createLioApplyMcpServer } from './packages/mcp';
import { CvOptimizationService } from './services/cv/cv-optimization.service';
import { TaskService } from './services/task-service/task-service.service';
import { getEvolutionApiKey, getEvolutionBaseUrl } from './utils/evolution';

async function registerEvolutionWebhook(port: number, logger: Logger) {
  const baseUrl = getEvolutionBaseUrl('http://localhost:8080');
  const apiKey = getEvolutionApiKey();
  const instanceName = process.env.INSTANCE_NAME;

  if (!apiKey || !instanceName) {
    logger.warn('⚠️ apiKey ou INSTANCE_NAME ausentes no .env — pulando auto-registro de webhook na Evolution API.');
    return;
  }

  const webhookUrl =
    process.env.WEBHOOK_PUBLIC_URL || `http://${process.env.WEBHOOK_HOST_IP || '172.17.0.1'}:${port}/webhook/evolution`;

  try {
    const response = await fetch(`${baseUrl}/webhook/set/${instanceName}`, {
      method: 'POST',
      headers: { apikey: apiKey, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        webhook: { enabled: true, url: webhookUrl, byEvents: false, base64: false, events: ['MESSAGES_UPSERT'] },
      }),
    });
    if (response.ok) {
      logger.log(`🔗 Webhook registrado automaticamente na Evolution API (${instanceName}) -> ${webhookUrl}`);
    } else {
      logger.warn(`⚠️ Evolution API retornou status ${response.status} ao registrar webhook: ${await response.text()}`);
    }
  } catch (err: any) {
    logger.warn(`⚠️ Não foi possível registrar webhook na Evolution API (${err.message}).`);
  }
}

async function runCliCv(app: INestApplicationContext, args: string[], cvFlagIndex: number, logger: Logger) {
  const flagArg = args[cvFlagIndex];
  const rawTarget = flagArg.includes('=') ? flagArg.split('=').slice(1).join('=') : args.slice(cvFlagIndex + 1).join(' ');
  if (!rawTarget?.trim()) throw new Error('Informe o ID da vaga ou link/descrição. Exemplo: pnpm cv 42');

  const cvService = app.get(CvOptimizationService);
  const cleanTarget = rawTarget.trim().replace(/^#/, '');
  const numericId = Number(cleanTarget);

  logger.log(`📄 Iniciando geração sob demanda de currículo para: "${rawTarget}"...`);
  const result =
    !Number.isNaN(numericId) && /^\d+$/.test(cleanTarget)
      ? await cvService.optimizeForStoredJobId(numericId)
      : await cvService.optimizeForCustomInput(rawTarget);

  const outputDir = path.resolve(process.cwd(), 'result');
  fs.mkdirSync(outputDir, { recursive: true });
  const localFilePath = path.join(outputDir, result.fileName);
  await fs.promises.writeFile(localFilePath, result.pdfBuffer);
  logger.log(`✅ Currículo gerado com sucesso: ${localFilePath} | ${result.evaluation.summaryReason}`);
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const args = process.argv.slice(2);

  if (args.includes('--mcp')) {
    await createLioApplyMcpServer().startStdio();
    return;
  }

  if (args.includes('--listen')) {
    const httpApp = await NestFactory.create(AppModule);
    httpApp.enableShutdownHooks();
    const port = Number(process.env.PORT || 3000);
    await httpApp.listen(port, '0.0.0.0');
    logger.log(`🎧 Receptor de comandos WhatsApp (/webhook/evolution) ativo em 0.0.0.0:${port}.`);
    await registerEvolutionWebhook(port, logger);
    return;
  }

  let app: INestApplicationContext | undefined;
  let exitCode = 0;
  try {
    app = await NestFactory.createApplicationContext(AppModule);
    const cvFlagIndex = args.findIndex((arg) => arg === '--cv' || arg.startsWith('--cv='));
    if (cvFlagIndex !== -1) {
      await runCliCv(app, args, cvFlagIndex, logger);
      return;
    }

    logger.log('🚀 Container iniciado — executando pipeline de scraping...');
    await app.get(TaskService).runScrapeJob();
  } catch (error) {
    exitCode = 1;
    logger.error('❌ Erro fatal no pipeline:', error);
  } finally {
    await app?.close().catch((closeErr) => {
      logger.warn(`⚠️ Erro ao encerrar aplicação: ${closeErr instanceof Error ? closeErr.message : closeErr}`);
    });
    process.exit(exitCode);
  }
}
bootstrap();
