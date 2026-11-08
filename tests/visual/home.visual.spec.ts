import { test, expect } from '../helpers/server.js';
import { awaitStableRender } from '../helpers/visual.js';
import { HomePage } from '../helpers/pages/home.js';

/**
 * Hide `.recent-section` entirely. Its contents are non-deterministic across
 * tests because the Go AccessTracker is an in-memory singleton that doesn't
 * reload from the per-test disk seed. Removing the section from layout (vs
 * masking it) keeps the rest of the page at a consistent vertical position.
 */
async function hideRecents(page: import('@playwright/test').Page) {
  await page.addStyleTag({ content: '.recent-section { display: none !important; }' });
}

test.describe('visual: home page', () => {
  test('default state with seeded fixtures', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await awaitStableRender(page);
    await hideRecents(page);
    await expect(page).toHaveScreenshot('home-default.png', { fullPage: true });
  });

  test('with active search filter', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await home.search('simple');
    await awaitStableRender(page);
    await hideRecents(page);
    await expect(page).toHaveScreenshot('home-search-active.png', { fullPage: true });
  });

  test('with active tag filter', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await home.clickTagFilter('Verified');
    await awaitStableRender(page);
    await hideRecents(page);
    await expect(page).toHaveScreenshot('home-tag-filter.png', { fullPage: true });
  });

  test('searching: no library match, hopamchuan results', async ({ page }) => {
    await page.route('**/music/hopamchuan-search**', (route) =>
      route.fulfill({
        json: [
          { id: '42', slug: 'dem-dong', title: 'Đêm Đông', artists: ['Nguyễn Văn Thương'] },
          { id: '43', slug: 'dem-dong-nho-em', title: 'Đêm Đông Nhớ Em', artists: ['Quang Lê'] },
        ],
      }),
    );
    const home = new HomePage(page);
    await home.goto();
    await home.search('dem dong');
    await home.searchBox.press('Enter');
    await expect(page.locator('.hac-result')).toHaveCount(2);
    await awaitStableRender(page);
    await expect(page).toHaveScreenshot('home-search-hopamchuan.png', { fullPage: true });
  });

  test('add-song preview sheet', async ({ page }) => {
    await page.route('**/music/hopamchuan-search**', (route) =>
      route.fulfill({ json: [{ id: '42', slug: 'dem-dong', title: 'Đêm Đông', artists: ['Nguyễn Văn Thương'] }] }),
    );
    await page.route('**/music/hopamchuan-import', (route) =>
      route.fulfill({
        json: {
          versions: [
            {
              url: 'u1',
              label: 'tuan',
              score: 9,
              isDefault: true,
              content:
                '(Intro)\n[Am] [Dm] [E7] [Am]\n\n(Verse 1)\n[Am]A first line with a [Dm]few chords [Am]in it\n[F]A longer second line that wraps on a [G]phone screen [C]here\n\n(Chorus)\n[Dm]Chorus [G]line [C]one\n[F]Chorus line [E7]two',
            },
            { url: 'u2', label: 'minh', score: 5, isDefault: false, content: '[C]Other' },
          ],
        },
      }),
    );
    const home = new HomePage(page);
    await home.goto();
    await home.search('dem dong');
    await home.searchBox.press('Enter');
    await page.locator('.hac-result').click();
    await expect(page.locator('.pv-line').first()).toBeVisible();
    await awaitStableRender(page);
    await expect(page).toHaveScreenshot('home-add-song-preview.png');
  });
});
