import type { Page } from '@playwright/test';

/**
 * Disable CSS animations + transitions and mock navigator.wakeLock. Called
 * on every page via the test fixture in server.ts. The init script runs
 * before any page script, including the app's own.
 */
export async function installVisualDeterminism(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Kill every animation and transition. Screenshot stability dies without this.
    const style = document.createElement('style');
    style.textContent = `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        caret-color: transparent !important;
      }
    `;
    // Run as soon as <head> exists.
    const attach = () => (document.head || document.documentElement).appendChild(style);
    if (document.head) attach();
    else document.addEventListener('DOMContentLoaded', attach, { once: true });

    // Mock wake-lock so wake-lock.js doesn't prompt for permission or fail
    // silently in headless Chromium.
    const mockSentinel = {
      released: false,
      release: () => Promise.resolve(),
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    };
    const wakeLockMock = {
      request: () => Promise.resolve(mockSentinel),
    };
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: wakeLockMock,
    });
  });
}

/**
 * Await webfonts + a short settle before taking a screenshot. Google Fonts
 * (Inter, Playfair Display, Lexend) load asynchronously — miss this and
 * every run looks subtly different from the last.
 */
export async function awaitStableRender(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  // Micro-settle for browser-internal reflow/paint after font swap.
  await page.waitForTimeout(50);
}

/**
 * Install default-deny network stubs. Allows:
 *   - any http://127.0.0.1:* / http://localhost:* (the test's own Go server)
 *   - fonts.googleapis.com + fonts.gstatic.com (webfont CSS/woff2)
 *   - the specific external hosts stubbed below (hopamchuan, YouTube)
 *
 * Any other external request is fulfilled with 418 to make missed stubs
 * fail loudly in tests instead of silently hitting the real internet.
 */
export async function installNetworkStubs(page: Page): Promise<void> {
  // Playwright route matching is LIFO — the MOST-RECENTLY-added route is
  // tried first. That means the broad default-deny MUST be registered FIRST
  // so specific stubs override it. Reversing this order causes the default
  // to capture every request before specific handlers see it.

  // Default-deny for external network. Localhost (our Go server) passes
  // through; fonts are allowed. Any other unstubbed external host fails
  // loudly so tests don't silently hit real servers.
  await page.route('**/*', async (route, request) => {
    const url = request.url();
    let host = '';
    try {
      host = new URL(url).host;
    } catch {
      // Malformed URL — let it through to produce a real error.
      await route.continue();
      return;
    }
    if (
      host.startsWith('127.0.0.1') ||
      host.startsWith('localhost') ||
      host === 'fonts.googleapis.com' ||
      host === 'fonts.gstatic.com'
    ) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 418,
      body: `blocked unstubbed external request: ${url}`,
    });
  });

  // Specific external hosts (defense in depth — most external traffic
  // happens server-side, which Playwright can't intercept, so these mostly
  // guard against accidental direct-from-browser calls).
  await page.route('**://hopamchuan.com/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><body>stubbed hopamchuan response</body></html>',
    });
  });
  await page.route('**://www.googleapis.com/youtube/v3/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [] }),
    });
  });

  // Our own server endpoints that would otherwise fan out to external
  // services. Tests that want populated results override any of these via
  // page.route() within the test body (last-registered wins).
  await page.route('**/music/hopamchuan-search**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });
  await page.route('**/music/hopamchuan-import', async (route) => {
    await route.fulfill({
      status: 500,
      body: 'unstubbed hopamchuan-import in test',
    });
  });
  await page.route('**/music/youtube-search**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });
  // The Media card triggers a server-side yt-dlp download on page load for
  // songs with a YouTube source. Never let that reach the real Go handler
  // (it would shell out to yt-dlp and hit YouTube). Tests that need a ready
  // or in-progress download override this.
  await page.route('**/music/download-audio', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'error', error: 'stubbed in tests' }),
    });
  });
}
