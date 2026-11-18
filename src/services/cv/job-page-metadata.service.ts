import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { Browser, BrowserContext, chromium, Page } from 'playwright';
import { applyLightweightStealth, CHROMIUM_ARGS } from '../../utils/browser';

export interface JobPageMetadata {
  title: string;
  company?: string;
  description: string;
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const DESCRIPTION_SELECTORS = [
  '[class*="description__text"]',
  '[class*="job-description"]',
  '[class*="jobDescription"]',
  '[data-testid*="description"]',
  '[id*="job-description"]',
  '[id*="description"]',
  'article',
  'main',
  '[class*="description"]',
  'body',
];

const collapseSpaces = (value: string): string => value.replace(/\s+/g, ' ').trim();

/** Fetches a job posting page (shared headless browser) and extracts title/company/description. */
@Injectable()
export class JobPageMetadataService implements OnModuleDestroy {
  private readonly logger = new Logger(JobPageMetadataService.name);
  private browserPromise: Promise<Browser> | null = null;

  async onModuleDestroy(): Promise<void> {
    if (!this.browserPromise) return;
    const browser = await this.browserPromise.catch(() => null);
    this.browserPromise = null;
    await browser?.close().catch(() => undefined);
  }

  async fetch(url: string): Promise<JobPageMetadata> {
    let context: BrowserContext | undefined;
    let page: Page | undefined;
    try {
      this.logger.log(`🌐 Extraindo HTML da vaga via Playwright: ${url}`);
      const browser = await this.getSharedBrowser();
      context = await browser.newContext({ userAgent: USER_AGENT, viewport: { width: 1280, height: 720 } });
      await applyLightweightStealth(context);

      page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
      return this.extractFromHtml(await page.content());
    } catch (error) {
      this.logger.warn(`⚠️ Falha ao extrair vaga via Playwright (${url}): ${error instanceof Error ? error.message : error}`);
      return { title: '', description: '' };
    } finally {
      await page?.close().catch(() => undefined);
      await context?.close().catch(() => undefined);
    }
  }

  extractFromHtml(html: string): JobPageMetadata {
    const $ = cheerio.load(html);
    const jsonLd = this.extractJobPostingJsonLd($);

    $('script, style, nav, footer, header, noscript, svg').remove();
    const pageTitle =
      jsonLd?.title ||
      $('h1').first().text().trim() ||
      $('meta[property="og:title"]').attr('content')?.trim() ||
      $('title').first().text().trim() ||
      '';

    let bestText = jsonLd?.description || '';
    if (bestText.length < 120) {
      for (const sel of DESCRIPTION_SELECTORS) {
        const text = collapseSpaces($(sel).first().text());
        if (text.length >= 120) {
          bestText = text;
          break;
        }
        if (text.length > bestText.length) bestText = text;
      }
    }

    if (bestText.length < 80) {
      const metaDesc =
        $('meta[property="og:description"]').attr('content')?.trim() ||
        $('meta[name="description"]').attr('content')?.trim() ||
        '';
      if (metaDesc.length > bestText.length) bestText = metaDesc;
    }

    return {
      title: collapseSpaces(pageTitle).substring(0, 120),
      company: jsonLd?.company,
      description: collapseSpaces(bestText).substring(0, 6000),
    };
  }

  private getSharedBrowser(): Promise<Browser> {
    if (!this.browserPromise) {
      this.browserPromise = chromium
        .launch({
          headless: true,
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
          args: CHROMIUM_ARGS,
        })
        .then((browser) => {
          browser.on?.('disconnected', () => {
            this.browserPromise = null;
          });
          return browser;
        })
        .catch((err) => {
          this.browserPromise = null;
          throw err;
        });
    }
    return this.browserPromise;
  }

  private extractJobPostingJsonLd($: cheerio.CheerioAPI): Partial<JobPageMetadata> | null {
    const scripts = $('script[type="application/ld+json"]');
    for (let i = 0; i < scripts.length; i++) {
      try {
        const parsed = JSON.parse($(scripts[i]).html() || '');
        const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.['@graph']) ? parsed['@graph'] : [parsed];
        const posting = items.find((item: { '@type'?: string }) => item?.['@type'] === 'JobPosting');
        if (posting) {
          const rawDesc = typeof posting.description === 'string' ? cheerio.load(posting.description).text() : '';
          return {
            title: typeof posting.title === 'string' ? posting.title.trim() : undefined,
            company: typeof posting.hiringOrganization?.name === 'string' ? posting.hiringOrganization.name.trim() : undefined,
            description: collapseSpaces(rawDesc),
          };
        }
      } catch {
        // ignore invalid JSON-LD blocks
      }
    }
    return null;
  }
}
