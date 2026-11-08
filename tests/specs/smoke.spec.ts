import { test, expect } from '../helpers/server.js';

test.describe('smoke — plumbing works end-to-end', () => {
  test('isolated server starts, seeded songs are visible', async ({ page, baseURL }) => {
    await page.goto('/music/songs');
    await expect(page).toHaveTitle('Song Library');
    // The seeded fixture set has 7 songs.
    await expect(page.locator('.song-count')).toHaveText('7 songs');
    // Confirm the seed landed on disk: song-list endpoint returns 7 slugs.
    const list = await page.request.get(`${baseURL}/music/song-list`);
    const slugs = (await list.json()) as string[];
    expect(slugs.sort()).toEqual(
      ['ConMuaNho', 'edge-cases', 'extended-chords', 'long-song', 'mixed-headers', 'repeat-brackets', 'simple-ballad']
        .sort(),
    );
  });

  test('each song row has a device-agnostic /music/song?songName=… href', async ({ page }) => {
    // Regression test for the Phase 4 URL bug: songList.js used to build
    // /music/desktop/song URLs that no longer resolve. Every song row must
    // link to the device-agnostic path.
    await page.goto('/music/songs');
    const hrefs = await page.locator('.song-list a').evaluateAll(
      (links) => links.map((a) => (a as HTMLAnchorElement).getAttribute('href') ?? ''),
    );
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href).toMatch(/^\/music\/song\?songName=/);
      expect(href).not.toMatch(/\/music\/(?:mobile|desktop)\//);
    }
  });

  test('/music/ redirects to /music/songs', async ({ baseURL, request }) => {
    const res = await request.get(`${baseURL}/music/`, { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers()['location']).toBe('/music/songs');
  });

  test('deleted /music/mobile/songs route returns 404', async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/music/mobile/songs`, { maxRedirects: 0 });
    expect(res.status()).toBe(404);
  });
});
