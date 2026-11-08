import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Page } from '@playwright/test';

import { test, expect } from '../helpers/server.js';
import { HomePage } from '../helpers/pages/home.js';

test.describe('home page — song library', () => {
  test('loads with title and correct song count', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await expect(home.songCount).toHaveText('7 songs');
    await expect(home.songItems()).toHaveCount(7);
  });

  test('every song row links to /music/song?songName= (no device prefix)', async ({ page }) => {
    // Regression guard for the Phase 4 URL bug. Any device-prefixed link
    // here would silently 404 in production.
    const home = new HomePage(page);
    await home.goto();
    const hrefs = await home.getSongHrefs();
    expect(hrefs.length).toBe(7);
    for (const href of hrefs) {
      expect(href).toMatch(/^\/music\/song\?songName=/);
      expect(href).not.toMatch(/\/music\/(?:mobile|desktop)\//);
    }
  });

  test('clicking a song row navigates to its song view', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await home.clickSongByName('Simple Ballad');
    await expect(page).toHaveURL(/\/music\/song\?songName=simple-ballad/);
    await expect(page.locator('#song-title-heading')).toContainText('Simple Ballad');
  });

  test('search filters by title (case-insensitive, substring)', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await home.search('simple');
    await expect(home.songItems()).toHaveCount(1);
    await expect(home.songItems().first()).toContainText('Simple Ballad');

    await home.search('SIMPLE'); // case-insensitive
    await expect(home.songItems()).toHaveCount(1);

    await home.search('');
    await expect(home.songItems()).toHaveCount(7);
  });

  test('search is diacritic-normalized (Vietnamese)', async ({ page }) => {
    // The "Cơn Mưa Nhỏ" title should match the diacritic-free query "con mua".
    const home = new HomePage(page);
    await home.goto();
    await home.search('con mua');
    await expect(home.songItems()).toHaveCount(1);
    await expect(home.songItems().first()).toContainText('Cơn Mưa Nhỏ');
  });

  test('search handles no-match gracefully', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await home.search('no-such-song-exists');
    await expect(home.songItems()).toHaveCount(0);
    // Empty-state message
    await expect(page.locator('.no-songs-container')).toBeVisible();
  });

  test('tag filter: All shows every song', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await home.clickTagFilter('All');
    await expect(home.songItems()).toHaveCount(7);
  });

  test('tag filter: Gig-ready shows only the Gig-ready fixture', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await home.clickTagFilter('Gig-ready');
    await expect(home.songItems()).toHaveCount(1);
    await expect(home.songItems().first()).toContainText('Repeat Test Song');
  });

  test('tag filter: Verified also shows Gig-ready songs', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await home.clickTagFilter('Verified');
    await expect(home.songItems()).toHaveText([
      /Cơn Mưa Nhỏ/,
      /Extended Chord Workout/,
      /Repeat Test Song/,
    ]);
  });

  test('tag filter: the retired tags are gone', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await expect(home.tagFilterBar.locator('button')).toHaveText([
      'Artist', 'All', 'Verified', 'Gig-ready', 'Ballad', 'Sôi động', 'Audio', 'Stems',
    ]);
  });

  test('Audio / Stems tags follow the audio files on disk', async ({ page, songsDir }) => {
    // ConMuaNho's audio source is YouTube video dQw4w9WgXcQ.
    const dir = join(songsDir, 'audio', 'youtube');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'dQw4w9WgXcQ_full.mp3'), '');

    const home = new HomePage(page);
    await home.goto();
    const row = home.songItems().filter({ hasText: 'Cơn Mưa Nhỏ' });
    await expect(row.locator('.song-tag')).toHaveText(['Verified']);
    await expect(row.getByRole('img')).toHaveCount(1);
    await expect(row.getByRole('img', { name: 'Audio' })).toBeVisible();
    await home.clickTagFilter('Stems');
    await expect(home.songItems()).toHaveCount(0);

    await writeFile(join(dir, 'dQw4w9WgXcQ_vocals.mp3'), '');
    await writeFile(join(dir, 'dQw4w9WgXcQ_accompaniment.mp3'), '');
    await page.reload();
    await expect(home.songItems()).toHaveText([/Cơn Mưa Nhỏ/]);
    await expect(row.getByRole('img', { name: 'Stems' })).toBeVisible();
  });

  test('the logo links back to /music/songs and is named ChordEdit', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await expect(home.logo).toHaveAttribute('href', '/music/songs');
    await expect(home.logo).toHaveAccessibleName('ChordEdit');
    await expect(home.logo.locator('.logo-name')).toBeVisible();
  });

  test('recently-played: visiting a song adds it to the recent chips list', async ({ page }) => {
    // NOTE: We don't assert starting-empty state. The AccessTracker is an
    // in-memory Go singleton; worker-level state carries across tests even
    // though .access_times.json gets wiped by seedAuto. This test only
    // characterizes the "visit → chip appears" behavior, which is what
    // the user cares about.
    const home = new HomePage(page);
    // Pick a slug unlikely to be left behind by other tests.
    const slug = 'extended-chords';
    await page.goto(`/music/song?songName=${slug}`);
    await expect(page.locator('#song-title-heading')).toContainText('Extended Chord Workout');

    await home.goto();
    await expect(page.locator('.recent-section')).toBeVisible();
    const hrefs = await home.recentChips().evaluateAll((els) =>
      els.map((a) => (a as HTMLAnchorElement).getAttribute('href') ?? ''),
    );
    expect(hrefs).toContain(`/music/song?songName=${slug}`);
  });

  test('pagination: 25 songs split across 2 pages', async ({ page, songsDir }) => {
    // Seed 25 extra stub songs on top of the 7 base fixtures, so we're above
    // the PAGE_SIZE=20 threshold (songList.js:6).
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const stubContent = '[C]Stub song';
    for (let i = 0; i < 25; i++) {
      await fs.writeFile(
        path.join(songsDir, `zz-pagination-${String(i).padStart(2, '0')}.txt`),
        stubContent,
      );
    }

    const home = new HomePage(page);
    await home.goto();
    await expect(home.songCount).toHaveText('32 songs');

    // Page 1: 20 items, pagination present
    await expect(home.songItems()).toHaveCount(20);
    await expect(home.pagination.locator('button', { hasText: /^2$/ })).toBeVisible();

    // Click page 2
    await home.pagination.locator('button', { hasText: /^2$/ }).click();
    await expect(home.songItems()).toHaveCount(12);

    // Prev button returns to page 1
    await home.pagination.locator('button', { hasText: '←' }).click();
    await expect(home.songItems()).toHaveCount(20);
  });
});

test.describe('home page — artists', () => {
  // Fixtures: Hoàng Dũng (Cơn Mưa Nhỏ, Simple Ballad), Sara Lưu (Extended
  // Chord Workout, Long Song), Jaykii (Extended Chord Workout); 3 without.
  const picker = (page: Page) => page.locator('.artist-picker');
  const openPicker = async (home: HomePage) => {
    await home.tagFilterBar.getByRole('button', { name: 'Artist', exact: true }).click();
    await expect(picker(home.page)).toBeVisible();
  };

  test('rows show their artists', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    const row = (title: string) => home.songItems().filter({ hasText: title });
    await expect(row('Extended Chord Workout').locator('.song-artist')).toHaveText('Jaykii, Sara Lưu');
    await expect(row('Repeat Test Song').locator('.song-artist')).toHaveCount(0);
  });

  test('the picker lists artists by song count, then No artist', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await openPicker(home);
    await expect(picker(page).locator('.artist-option-name')).toHaveText([
      'Hoàng Dũng', 'Sara Lưu', 'Jaykii', 'No artist',
    ]);
    await expect(picker(page).locator('.artist-option-count')).toHaveText(['2', '2', '1', '3']);

    await picker(page).locator('.artist-search').fill('sara');
    await expect(picker(page).locator('.artist-option-name')).toHaveText(['Sara Lưu']);

    await page.keyboard.press('Escape');
    await expect(picker(page)).toBeHidden();
  });

  test('picking an artist filters, combines with a tag, and clears', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await openPicker(home);
    await picker(page).getByRole('button', { name: /Sara Lưu/ }).click();
    await expect(picker(page)).toBeHidden();
    await expect(home.songItems()).toHaveText([/Extended Chord Workout/, /Long Song/]);
    await expect(page).toHaveURL(/artist=Sara\+L%C6%B0u/);
    await expect(home.tagFilterBar.locator('.artist-filter-name')).toHaveText('Sara Lưu');

    await home.clickTagFilter('Verified');
    await expect(home.songItems()).toHaveText([/Extended Chord Workout/]);

    await home.tagFilterBar.getByRole('button', { name: 'Clear artist filter' }).click();
    await expect(home.songItems()).toHaveText([/Cơn Mưa Nhỏ/, /Extended Chord Workout/, /Repeat Test Song/]);
    await expect(page).not.toHaveURL(/artist=/);
  });

  test('No artist shows the songs without one', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await openPicker(home);
    await picker(page).getByRole('button', { name: /No artist/ }).click();
    await expect(home.songItems()).toHaveCount(3);
    await expect(home.songItems().locator('.song-artist')).toHaveCount(0);
  });

  test('?artist= in the URL pre-selects the artist', async ({ page }) => {
    await page.goto('/music/songs?artist=' + encodeURIComponent('Hoàng Dũng'));
    const home = new HomePage(page);
    await expect(home.songItems()).toHaveText([/Cơn Mưa Nhỏ/, /Simple Ballad/]);
  });

  test('search matches artist names', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await home.search('hoang dung');
    await expect(home.songItems()).toHaveText([/Cơn Mưa Nhỏ/, /Simple Ballad/]);
  });
});

