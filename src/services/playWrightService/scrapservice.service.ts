import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { Browser, BrowserContext, Page } from 'playwright';
import { ILocationOption, IProviderConfig, Isearch, type ScrapeTask } from '../../interfaces/isearch/isearch.interface';
import { ScrapedPost } from '../../interfaces/ScrapedPost/iscrapedpost.interface';
import { applyLightweightStealth, launchChromium, DEFAULT_USER_AGENT } from '../../utils/browser';

@Injectable()
export class PlaywrightService {
  private readonly logger = new Logger(PlaywrightService.name);
  private readonly defaultConcurrency = this.parseConcurrency(process.env.SCRAPER_CONCURRENCY);

  private parseConcurrency(raw?: string): number {
    if (!raw) return 3;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 1) {
      this.logger.warn(`SCRAPER_CONCURRENCY inválido ("${raw}"); usando fallback 1.`);
      return 1;
    }
    return Math.floor(parsed);
  }

  async startBrowser(): Promise<{ browser: Browser; context: BrowserContext }> {
    const browser = await launchChromium();

    try {
      const context = await browser.newContext({
        userAgent: DEFAULT_USER_AGENT,
        viewport: { width: 1280, height: 720 },
        locale: 'pt-BR',
        timezoneId: 'America/Sao_Paulo',
      });

      await applyLightweightStealth(context);

      return { browser, context };
    } catch (error) {
      await browser.close().catch(() => undefined);
      throw error;
    }
  }

  isLocationSupported(provider: IProviderConfig, locOption: ILocationOption): boolean {
    if (locOption.provider && locOption.provider !== provider.name) return false;
    return !(provider.supportsLocation && !provider.supportsLocation(locOption));
  }

  async scrapeProviders(
    providers: IProviderConfig[],
    queries: string[],
    locations: ILocationOption[],
    concurrency = this.defaultConcurrency,
  ): Promise<ScrapedPost[]> {
    const tasks = this.buildTasks(providers, queries, locations);
    if (tasks.length === 0) return [];

    const { browser, context } = await this.startBrowser();
    try {
      return await this.runWorkerPool(context, tasks, concurrency);
    } catch (error) {
      this.logger.error('Erro crítico no processo de scrape:', error);
      throw error;
    } finally {
      await browser.close();
    }
  }

  async scrape(search: Isearch): Promise<ScrapedPost[]> {
    return this.scrapeProviders([search.provider], search.searchQueries, search.location || []);
  }

  private buildTasks(providers: IProviderConfig[], queries: string[], locations: ILocationOption[]): ScrapeTask[] {
    const tasks: ScrapeTask[] = [];
    for (const provider of providers) {
      for (const query of queries) {
        for (const locOption of locations) {
          if (this.isLocationSupported(provider, locOption)) tasks.push({ provider, query, locOption });
        }
      }
    }
    return tasks;
  }

  private async runWorkerPool(context: BrowserContext, tasks: ScrapeTask[], concurrency: number): Promise<ScrapedPost[]> {
    const allJobs: ScrapedPost[] = [];
    let taskIndex = 0;
    const safeConcurrency = Number.isFinite(concurrency) && concurrency >= 1 ? Math.floor(concurrency) : 1;
    const workerCount = Math.min(safeConcurrency, tasks.length);

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (taskIndex < tasks.length) {
          const task = tasks[taskIndex++];
          if (task) allJobs.push(...(await this.scrapeSingleTask(context, task)));
        }
      }),
    );
    return allJobs;
  }

  private async scrapeSingleTask(
    context: BrowserContext,
    { provider, query, locOption }: ScrapeTask,
  ): Promise<ScrapedPost[]> {
    const page = await context.newPage();
    try {
      const searchUrl = provider.buildSearchUrl(query, locOption);
      this.logger.log(`[${provider.name}] (${locOption.label || 'Busca'}) Navegando para: ${searchUrl}`);

      const response = await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      if (response && response.status() >= 400) {
        this.logger.warn(
          `[${provider.name}] HTTP ${response.status()} ao acessar ${searchUrl} (possível bloqueio/rate-limit/Cloudflare).`,
        );
      }
      await this.safeScroll(page, 300);

      try {
        await page.waitForSelector(provider.selectors.waitSelector, { timeout: 15000 });
      } catch {
        await this.safeScroll(page, 500);
        this.logger.warn(
          `Aviso: Seletor '${provider.selectors.waitSelector}' não apareceu a tempo para [${provider.name} | ${query} | ${locOption.label || 'Busca'}]`,
        );
      }

      await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => undefined);
      return this.parseHtml(await this.safeContent(page), provider, locOption.label);
    } catch (err) {
      this.logger.error(`Erro no scrape da combinação [${provider.name} | ${query}]:`, err);
      return [];
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  private async safeScroll(page: Page, deltaY: number): Promise<void> {
    try {
      await page.evaluate((y) => window.scrollBy(0, y), deltaY);
    } catch (err) {
      if (!String((err as Error)?.message ?? err).includes('Execution context was destroyed')) throw err;
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => undefined);
      await page.evaluate((y) => window.scrollBy(0, y), deltaY).catch(() => undefined);
    }
  }

  private async safeContent(page: Page, attempts = 3): Promise<string> {
    for (let i = 0; i < attempts; i++) {
      try {
        return await page.content();
      } catch (err) {
        const msg = String((err as Error)?.message ?? err);
        const isNavigating =
          msg.includes('page is navigating') || msg.includes('Execution context was destroyed');
        if (!isNavigating || i === attempts - 1) throw err;
        await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => undefined);
        if (typeof page.waitForTimeout === 'function') {
          await page.waitForTimeout(300).catch(() => undefined);
        }
      }
    }
    return page.content();
  }

  parseHtml(html: string, provider: IProviderConfig, locationLabel?: string): ScrapedPost[] {
    const $ = cheerio.load(html);
    const jobs: ScrapedPost[] = [];
    const { selectors } = provider;

    $(selectors.container).each((_, element) => {
      const title = $(element).find(selectors.jobTitle).text().trim();
      if (!title) return;

      const cleanCompany = $(element)
        .find(selectors.companyName)
        .first()
        .text()
        .trim()
        .replace(/\d+([.,]\d+)?\s*$/, '')
        .trim();

      let url = $(element).find(selectors.jobLink).attr('href') || '';
      if (url && !url.startsWith('http')) {
        url = `${selectors.baseUrl.replace(/\/$/, '')}${url.startsWith('/') ? url : `/${url}`}`;
      }

      jobs.push({
        title,
        company: cleanCompany || undefined,
        location: locationLabel,
        text: cleanCompany ? `Vaga: ${title} | Empresa: ${cleanCompany}` : `Vaga: ${title}`,
        url,
      });
    });

    return jobs;
  }
}
