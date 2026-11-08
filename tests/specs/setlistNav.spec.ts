import { test, expect } from '../helpers/server.js';
import type { Page } from '@playwright/test';

/**
 * Setlist navigation on the song page (src/features/setlistContext): the
 * Display bar's "Gig · 2/3  ‹ ›", and paged Perform turning past a song's
 * first / last page into the setlist's previous / next song.
 */

const SONGS = ['simple-ballad', 'mixed-headers', 'long-song'];

async function createGig(page: Page): Promise<void> {
  const res = await page.request.post('/music/save-setlist', { data: { name: 'Gig', songs: SONGS } });
  expect(res.ok()).toBe(true);
}

const nav = (page: Page) => page.locator('.display-bar .setlist-nav');

test.describe('song page: setlist navigation', () => {
  test('opened from a setlist, the Display bar shows its name, position and ‹ ›', async ({ page }) => {
    await createGig(page);
    await page.goto('/music/song?songName=mixed-headers&setlist=Gig');

    await expect(nav(page)).toBeVisible();
    await expect(nav(page).locator('.setlist-nav-name')).toHaveText('Gig · 2/3');
    await expect(nav(page).locator('.setlist-nav-name')).toHaveAttribute('href', '/music/setlist?name=Gig');
    await expect(nav(page).locator('[data-dir="prev"]')).toHaveAttribute('href', /songName=simple-ballad&setlist=Gig/);

    await nav(page).locator('[data-dir="next"]').click();
    await expect(page).toHaveURL(/songName=long-song&setlist=Gig/);
    await expect(nav(page).locator('.setlist-nav-name')).toHaveText('Gig · 3/3');
    // The last song has no next.
    await expect(nav(page).locator('[data-dir="next"]')).toHaveAttribute('aria-disabled', 'true');
    await expect(nav(page).locator('[data-dir="next"]')).not.toHaveAttribute('href');
  });

  test('without a setlist the Display bar has no setlist controls', async ({ page }) => {
    await page.goto('/music/song?songName=mixed-headers');
    await expect(page.locator('#song-title-heading')).toBeVisible();
    await expect(nav(page)).toBeHidden();
  });

  test.describe('paged Perform (wide touch screen)', () => {
    test.use({ viewport: { width: 1000, height: 700 }, hasTouch: true, isMobile: true });

    test('turning past the last page opens the next song; back from page 1 the previous one', async ({ page }) => {
      await createGig(page);
      await page.goto('/music/song?songName=mixed-headers&setlist=Gig');
      await expect(nav(page)).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const indicator = page.locator('.page-indicator');

      // Walk forward through the song's pages, then one more turn.
      const total = await indicator.isVisible()
        ? Number((await indicator.textContent())!.split('/')[1])
        : 1;
      for (let i = 1; i < total; i++) await page.keyboard.press('PageDown');
      await page.keyboard.press('PageDown');
      await expect(page).toHaveURL(/songName=long-song&setlist=Gig/);

      await expect(nav(page)).toBeVisible();
      await page.keyboard.press('PageUp');
      await expect(page).toHaveURL(/songName=mixed-headers&setlist=Gig/);
    });

    test('without a setlist, page turns stop at the ends', async ({ page }) => {
      await page.goto('/music/song?songName=simple-ballad');
      await expect(page.locator('#song-title-heading')).toBeVisible();
      await page.keyboard.press('PageUp');
      await page.keyboard.press('PageDown');
      await page.keyboard.press('PageDown');
      await expect(page).toHaveURL(/songName=simple-ballad$/);
    });
  });
});
