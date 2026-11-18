import type { BrowserContext } from 'playwright';

export const CHROMIUM_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-blink-features=AutomationControlled',
];

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
