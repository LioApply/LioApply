import { type Browser, type BrowserContext, chromium } from 'playwright';

export const CHROMIUM_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-blink-features=AutomationControlled',
];

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const BLOCKED_RESOURCE_TYPES = ['image', 'media', 'font'];

/** Hides the webdriver flag and aborts heavy resources (images/media/fonts) to speed up scraping. */
export async function applyLightweightStealth(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  await context.route('**/*', (route) =>
    BLOCKED_RESOURCE_TYPES.includes(route.request().resourceType()) ? route.abort() : route.continue(),
  );
}

/** Launches a headless Chromium honoring `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. */
export const launchChromium = (): Promise<Browser> =>
  chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    args: CHROMIUM_ARGS,
  });
