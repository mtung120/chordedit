import { test, expect } from '../helpers/server.js';
import type { Page, Request } from '@playwright/test';
import { HomePage } from '../helpers/pages/home.js';

/**
 * Adding songs from the home page's search field (src/features/home/addSong.ts):
 * library matches first, then hopamchuan.com (searched by itself 1 s after
 * typing stops when the library has no match), a preview sheet with the
 * whole song, and Blank song.
 */

const RESULTS = [
  { id: '42', slug: 'dem-dong', title: 'Đêm Đông', artists: ['Nguyễn Văn Thương'] },
  { id: '43', slug: 'simple-ballad', title: 'Simple Ballad', artists: ['Someone'] },
];

const VERSIONS = [
  {
    url: 'https://hopamchuan.com/song/42/dem-dong/',
    label: 'tuan',
    score: 9,
    isDefault: true,
    content: '(Intro)\n[Am] [Dm]\n\n(Verse 1)\n[Am]First line [E7]here\n\n(Chorus)\n[F]Last line',
  },
  {
    url: 'https://hopamchuan.com/song/42/dem-dong/v/minh',
    label: 'minh',
    score: 5,
    isDefault: false,
    content: '(Verse 1)\n[C]Second version',
  },
];

async function stubHopamchuan(page: Page): Promise<Request[]> {
  const searches: Request[] = [];
  await page.route('**/music/hopamchuan-search**', async (route, request) => {
    searches.push(request);
    await route.fulfill({ json: RESULTS });
  });
  await page.route('**/music/hopamchuan-import', (route) => route.fulfill({ json: { versions: VERSIONS } }));
  return searches;
}

test.describe('home: search or add a song', () => {
  test('a library match offers a hopamchuan search instead of running one', async ({ page }) => {
    const searches = await stubHopamchuan(page);
    const home = new HomePage(page);
    await home.goto();
    await home.search('simple');

    await expect(home.songItems()).toHaveCount(1);
    await expect(page.locator('.search-label').first()).toHaveText('In your library');
    await expect(page.locator('.setlists-section')).toBeHidden();
    await expect(page.locator('.tag-filter-bar')).toBeHidden();
    const offer = page.locator('.hac-offer');
    await expect(offer).toContainText('Search hopamchuan.com');
    await expect(offer).toContainText('for “simple”');
    await page.waitForTimeout(1300);
    expect(searches).toHaveLength(0);

    await offer.click();
    await expect(page.locator('.hac-result')).toHaveCount(2);
    expect(searches).toHaveLength(1);
    // Library matches stay above the hopamchuan results.
    const libraryBox = await home.songItems().first().boundingBox();
    const resultBox = await page.locator('.hac-result').first().boundingBox();
    expect(libraryBox!.y).toBeLessThan(resultBox!.y);
  });

  test('no library match: hopamchuan is searched 1 s after typing stops', async ({ page }) => {
    await page.clock.install();
    const searches = await stubHopamchuan(page);
    const home = new HomePage(page);
    await home.goto();
    await home.search('dem do');
    await home.search('dem dong');

    await expect(page.locator('.no-songs')).toHaveText('No songs match “dem dong”');
    await expect(page.locator('.hac-status')).toContainText('Searching…');
    await page.clock.runFor(900);
    expect(searches).toHaveLength(0);
    await page.clock.runFor(200);
    await expect(page.locator('.hac-result')).toHaveCount(2);
    expect(searches).toHaveLength(1);
    expect(new URL(searches[0]!.url()).searchParams.get('q')).toBe('dem dong');
    await expect(page.locator('.hac-result-title')).toHaveText(['Đêm Đông', 'Simple Ballad']);
  });

  test('Enter searches hopamchuan right away; clearing the field restores the library', async ({ page }) => {
    const searches = await stubHopamchuan(page);
    const home = new HomePage(page);
    await home.goto();
    await home.search('simple');
    await home.searchBox.press('Enter');
    await expect(page.locator('.hac-result')).toHaveCount(2);
    expect(searches).toHaveLength(1);

    await page.locator('.song-search-clear').click();
    await expect(home.searchBox).toHaveValue('');
    await expect(page.locator('.add-song')).toBeHidden();
    await expect(page.locator('.tag-filter-bar')).toBeVisible();
    await expect(page.locator('.song-search-clear')).toBeHidden();
  });

  test('the tag filter does not apply while searching', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await home.clickTagFilter('Gig-ready'); // simple-ballad isn't Gig-ready
    await home.search('simple');
    await expect(home.songItems()).toHaveCount(1);
  });

  test('preview shows the whole song and its versions; Add creates the song and opens it', async ({ page }) => {
    await stubHopamchuan(page);
    const home = new HomePage(page);
    await home.goto();
    await home.search('dem dong');
    await home.searchBox.press('Enter');
    await page.locator('.hac-result', { hasText: 'Đêm Đông' }).click();

    const sheet = page.locator('.add-song-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('.add-song-title')).toHaveText('Đêm Đông');
    await expect(sheet.locator('.add-song-version-count')).toHaveText('Version 1 of 2');
    await expect(sheet.locator('.pv-header')).toHaveText(['Intro', 'Verse 1', 'Chorus']);
    await expect(sheet.locator('.pv-chord').first()).toHaveText('Am');
    await expect(sheet.locator('.add-song-note')).toBeHidden();

    await sheet.locator('.add-song-next').click();
    await expect(sheet.locator('.add-song-version-count')).toHaveText('Version 2 of 2');
    await expect(sheet.locator('.pv-line')).toHaveText(['CSecond version']);
    await sheet.locator('.add-song-prev').click();

    const created = page.waitForRequest((r) => r.url().endsWith('/music/songs') && r.method() === 'POST');
    await sheet.locator('.add-song-confirm').click();
    const body = JSON.parse((await created).postData() ?? '{}');
    expect(body).toEqual({
      songName: 'Dem Dong',
      title: 'Đêm Đông',
      content: VERSIONS[0]!.content,
      artists: ['Nguyễn Văn Thương'],
    });
    await expect(page).toHaveURL(/\/music\/song\?songName=Dem%20Dong$/);
    await expect(page.locator('#song-title-heading')).toHaveText('Đêm Đông');

    // The artist was stored: the library shows it under the title.
    await home.goto();
    await expect(home.songItems().filter({ hasText: 'Đêm Đông' }).locator('.song-artist')).toHaveText(
      'Nguyễn Văn Thương',
    );
  });

  test('a song with the same title as a library song is added as a new version', async ({ page }) => {
    await stubHopamchuan(page);
    const home = new HomePage(page);
    await home.goto();
    await home.search('ballad');
    await page.locator('.hac-offer').click();
    await page.locator('.hac-result', { hasText: 'Simple Ballad' }).click();

    const sheet = page.locator('.add-song-sheet');
    await expect(sheet.locator('.add-song-note')).toContainText('You already have Simple Ballad');
    await expect(sheet.locator('.add-song-confirm')).toHaveText('Add as new version');
    await expect(sheet.locator('.add-song-confirm')).toBeEnabled();

    const created = page.waitForRequest((r) => r.url().includes('/music/create-version'));
    await sheet.locator('.add-song-confirm').click();
    const body = JSON.parse((await created).postData() ?? '{}');
    expect(body).toMatchObject({ songName: 'simple-ballad', content: VERSIONS[0]!.content, label: 'hopamchuan' });
    await expect(page).toHaveURL(/songName=simple-ballad&v=1$/);
  });

  test('the preview closes with ×, Escape and a tap outside', async ({ page }) => {
    await stubHopamchuan(page);
    const home = new HomePage(page);
    await home.goto();
    await home.search('dem dong');
    await home.searchBox.press('Enter');
    const result = page.locator('.hac-result').first();
    const overlay = page.locator('.add-song-overlay');

    await result.click();
    await page.locator('.add-song-close').click();
    await expect(overlay).toBeHidden();

    await result.click();
    await page.keyboard.press('Escape');
    await expect(overlay).toBeHidden();

    await result.click();
    await overlay.click({ position: { x: 5, y: 5 } });
    await expect(overlay).toBeHidden();
  });

  test('Blank song creates "New song XXXX" and opens it in Edit with Raw text open', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await home.search('anything');
    await page.locator('.blank-song-btn').click();

    await expect(page).toHaveURL(/songName=New%20song%20[A-Z0-9]{4}$/);
    await expect(page.locator('#song-title-heading')).toHaveText(/^New song [A-Z0-9]{4}$/);
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'edit');
    await expect(page.locator('.raw-text-editor')).toBeVisible();
    await expect(page.locator('.raw-text-area')).toBeFocused();
  });
});
