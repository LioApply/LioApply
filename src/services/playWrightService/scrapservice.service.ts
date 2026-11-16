import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { Browser, BrowserContext, chromium, Page } from 'playwright';
import { ILocationOption, IProviderConfig, Isearch } from '../../interfaces/isearch/isearch.interface';
import { ScrapedPost } from '../../interfaces/ScrapedPost/iscrapedpost.interface';

interface ScrapeTask {
  provider: IProviderConfig;
  query: string;
  locOption: ILocationOption;
}

const CHROMIUM_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-blink-features=AutomationControlled',
];

@Injectable()
export class PlaywrightService {
  private readonly logger = new Logger(PlaywrightService.name);
  private readonly defaultConcurrency = Number(process.env.SCRAPER_CONCURRENCY || 3);

  async startBrowser(): Promise<{ browser: Browser; context: BrowserContext }> {
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      args: CHROMIUM_ARGS,
    });

    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    await context.route('**/*', (route) => {
      const type = route.request().resourceType();
      return ['image', 'media', 'font'].includes(type) ? route.abort() : route.continue();
    });

    return { browser, context };
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
    const workerCount = Math.min(Math.max(1, concurrency), tasks.length);

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

      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
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
      return this.parseHtml(await page.content(), provider, locOption.label);
    } catch (err) {
      this.logger.error(`Erro no scrape da combinação [${provider.name} | ${query}]:`, err);
      return [];
    } finally {
      await page.close();
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
