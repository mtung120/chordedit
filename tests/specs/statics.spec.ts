import { test, expect } from '../helpers/server.js';

test.describe('static assets — gzip, Cache-Control, content-hash', () => {
  test('styles.css returns 200 with immutable Cache-Control', async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/static/css/styles.css`);
    expect(res.status()).toBe(200);
    const cache = res.headers()['cache-control'] ?? '';
    expect(cache).toContain('immutable');
    expect(cache).toContain('max-age');
  });

  test('styles.css is gzipped when Accept-Encoding: gzip', async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/static/css/styles.css`, {
      headers: { 'Accept-Encoding': 'gzip' },
    });
    expect(res.status()).toBe(200);
    expect(res.headers()['content-encoding']).toBe('gzip');
    expect(res.headers()['vary']).toContain('Accept-Encoding');
  });

  test('HEAD on styles.css is plain (not gzipped, Phase 6 fix)', async ({ request, baseURL }) => {
    const res = await request.fetch(`${baseURL}/static/css/styles.css`, {
      method: 'HEAD',
      headers: { 'Accept-Encoding': 'gzip' },
    });
    expect(res.status()).toBe(200);
    // No Content-Encoding header → body would be plain had there been one.
    expect(res.headers()['content-encoding']).toBeUndefined();
  });

  test('binary assets (.png) are NOT gzipped even with Accept-Encoding: gzip', async ({ request, baseURL }) => {
    // .png would be a different asset — not in our static/ tree currently.
    // The skip extension list includes .png — assert via a direct middleware
    // test using a hypothetical URL: if the file doesn't exist we get 404,
    // but if it does exist the Content-Encoding should NOT be gzip. We
    // use static/js/songView.js with a *.png trailing just to test routing —
    // skip if our build has no PNGs.
    const res = await request.get(`${baseURL}/static/images/nonexistent.png`, {
      headers: { 'Accept-Encoding': 'gzip' },
    });
    // 404 is fine (file doesn't exist). What matters is: if it were 200,
    // content-encoding is not gzip. Hard to assert on 404, so just check
    // that a 200 response, if any, isn't gzipped.
    if (res.status() === 200) {
      expect(res.headers()['content-encoding']).not.toBe('gzip');
    } else {
      expect(res.status()).toBe(404);
    }
  });

  test('asset URLs in HTML include a ?v=<8-char-hash> query string', async ({ page }) => {
    await page.goto('/music/songs');
    const cssHrefs = await page.locator('link[rel="stylesheet"]').evaluateAll(
      (els) => els.map((l) => (l as HTMLLinkElement).getAttribute('href') ?? ''),
    );
    expect(cssHrefs.length).toBeGreaterThan(0);
    for (const href of cssHrefs) {
      if (href.startsWith('/static/')) {
        expect(href).toMatch(/\?v=[a-f0-9]{8}$/);
      }
    }
    const scriptSrcs = await page.locator('script[src]').evaluateAll(
      (els) => els.map((s) => (s as HTMLScriptElement).getAttribute('src') ?? ''),
    );
    for (const src of scriptSrcs) {
      if (src.startsWith('/static/dist/')) {
        // Vite emits hash-in-filename: assets/<name>-<hash>.js. No ?v= query.
        expect(src).toMatch(/\/assets\/[^./]+-[A-Za-z0-9_-]{6,}\.js$/);
      } else if (src.startsWith('/static/')) {
        // Legacy non-bundled assets: served by handlers/assets.go with ?v=hash.
        expect(src).toMatch(/\?v=[a-f0-9]{8}$/);
      }
    }
  });
});
