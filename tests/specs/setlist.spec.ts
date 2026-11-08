import { test, expect } from '../helpers/server.js';
import type { Page } from '@playwright/test';

/**
 * Setlist page (src/features/setlistEditor) and the home page's Setlists
 * section. A setlist that doesn't exist yet opens in edit mode and is
 * created on its first save.
 */

const saved = (page: Page) =>
  page.waitForRequest((r) => r.url().includes('/music/save-setlist') && r.method() === 'POST');

async function addSong(page: Page, query: string): Promise<void> {
  await page.locator('.setlist-add-song-btn').click();
  await page.locator('.song-picker-search').fill(query);
  await page.locator('.song-picker-item').first().click();
  await expect(page.locator('.song-picker-overlay')).toBeHidden();
}

/** Create "Gig" with two songs; returns once it's saved. */
async function createGig(page: Page): Promise<void> {
  await page.goto('/music/setlist?name=Gig');
  await expect(page.locator('.setlist-edit-toggle')).toHaveText('Done');
  const save = saved(page);
  await addSong(page, 'Simple');
  await addSong(page, 'mixed');
  await save;
  await expect(page.locator('.setlist-save-indicator')).toHaveText(/Saved/);
}

test.describe('setlist page', () => {
  test('a new setlist opens in edit mode; songs added from the picker are saved', async ({ page }) => {
    await createGig(page);
    const rows = page.locator('.setlist-songs-list .song-item');
    await expect(rows.locator('.song-name')).toHaveText(['Simple Ballad', 'mixed-headers']);
    await expect(page.locator('.setlist-songs-count')).toHaveText('2 songs');

    // Reloaded, it opens read-only: rows link to the song with the setlist.
    await page.goto('/music/setlist?name=Gig');
    await expect(page.locator('.setlist-edit-toggle')).toHaveText('Edit');
    await expect(page.locator('.setlist-add-song-btn')).toBeHidden();
    await expect(page.locator('.setlist-danger-zone')).toBeHidden();
    await expect(rows.first()).toHaveAttribute('href', /songName=simple-ballad.*setlist=Gig/);
  });

  test('Edit shows the drag handles and remove buttons; removing a song saves', async ({ page }) => {
    await createGig(page);
    await page.goto('/music/setlist?name=Gig');
    await page.locator('.setlist-edit-toggle').click();
    await expect(page.locator('.setlist-edit-toggle')).toHaveText('Done');
    await expect(page.locator('.setlist-song-handle')).toHaveCount(2);

    const save = saved(page);
    await page.locator('.setlist-song-remove').first().click();
    expect(JSON.parse((await save).postData() ?? '{}').songs).toEqual(['mixed-headers']);
    await expect(page.locator('.setlist-songs-count')).toHaveText('1 song');
  });

  test('the picker marks songs already in the setlist', async ({ page }) => {
    await createGig(page);
    await page.locator('.setlist-add-song-btn').click();
    await page.locator('.song-picker-search').fill('Simple');
    await expect(page.locator('.song-picker-item')).toHaveClass(/already-added/);
    await page.locator('.song-picker-close').click();
    await expect(page.locator('.song-picker-overlay')).toBeHidden();
  });

  test('the home page lists setlists and opens them', async ({ page }) => {
    await createGig(page);
    await page.goto('/music/songs');
    const row = page.locator('.setlist-row', { hasText: 'Gig' });
    await expect(row.locator('.setlist-row-meta')).toHaveText('2 songs');
    await row.click();
    await expect(page).toHaveURL(/\/music\/setlist\?name=Gig/);
  });
});
