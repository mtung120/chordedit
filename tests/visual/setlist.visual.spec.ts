import { test, expect } from '../helpers/server.js';
import type { Page } from '@playwright/test';
import { awaitStableRender } from '../helpers/visual.js';

/** "Gig" with two songs, saved, then reopened read-only. */
async function openGig(page: Page): Promise<void> {
  await page.goto('/music/setlist?name=Gig');
  for (const q of ['Simple', 'mixed']) {
    const save = page.waitForRequest((r) => r.url().includes('/music/save-setlist'));
    await page.locator('.setlist-add-song-btn').click();
    await page.locator('.song-picker-search').fill(q);
    await page.locator('.song-picker-item').first().click();
    await save;
  }
  await page.goto('/music/setlist?name=Gig');
}

test.describe('visual: setlist page', () => {
  test('viewing a setlist', async ({ page }) => {
    await openGig(page);
    await awaitStableRender(page);
    await expect(page).toHaveScreenshot('setlist-view.png', { fullPage: true });
  });

  test('editing a setlist', async ({ page }) => {
    await openGig(page);
    await page.locator('.setlist-edit-toggle').click();
    await awaitStableRender(page);
    await expect(page).toHaveScreenshot('setlist-edit.png', { fullPage: true });
  });
});
