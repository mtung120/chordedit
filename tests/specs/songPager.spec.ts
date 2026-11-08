import { test, expect } from '../helpers/server.js';
import { SongViewPage } from '../helpers/pages/songView.js';

/**
 * Book-style paging in Perform on wide touch screens
 * (src/features/songPager/songPager.ts). A short landscape touch viewport
 * makes long-song span several pages.
 */
test.describe('song view — paged Perform', () => {
  test.use({ viewport: { width: 900, height: 420 }, hasTouch: true });

  test('flips pages by tap and keys, and resets outside Perform', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('long-song');
    const indicator = page.locator('.page-indicator');
    const strip = page.locator('#songView');

    await expect(indicator).toHaveText(/^1 \/ [2-9]$/);
    // The page itself never scrolls; columns overflow to the right.
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(420);

    await page.touchscreen.tap(850, 300);
    await expect(indicator).toHaveText(/^2 \//);
    await expect(strip).toHaveAttribute('style', /translateX\(-\d+px\)/);

    await page.touchscreen.tap(50, 300);
    await expect(indicator).toHaveText(/^1 \//);

    await page.keyboard.press('PageDown');
    await expect(indicator).toHaveText(/^2 \//);
    await page.keyboard.press('ArrowLeft');
    await expect(indicator).toHaveText(/^1 \//);

    await page.keyboard.press('ArrowRight');
    await sv.setMode('edit');
    await expect(indicator).toBeHidden();
    await expect(strip).not.toHaveAttribute('style', /translateX/);
  });

  test('half turns move one column; the toggle switches to full pages and is remembered', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('long-song');
    const indicator = page.locator('.page-indicator');
    const toggle = page.locator('.page-turn-btn');
    const shift = async () => page.locator('#songView').evaluate((el) => {
      const m = /translateX\((-?[\d.]+)px\)/.exec(el.style.transform);
      return m ? -Number(m[1]) : 0;
    });
    const contentWidth = await page.locator('.content').evaluate((el) => el.clientWidth);

    await expect(toggle).toHaveText('Half page');
    const halfSteps = Number((await indicator.textContent())!.split('/')[1]);
    await page.keyboard.press('PageDown');
    await expect(indicator).toHaveText(/^2 \//);
    // One column: half of the screen plus half a gap.
    const half = await shift();
    expect(half).toBeGreaterThan(contentWidth / 2);
    expect(half).toBeLessThan(contentWidth * 0.6);
    // The incoming column's cover is gone once the turn settles.
    await expect(page.locator('.page-turn-cover')).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveText('Full page');
    await expect(indicator).toHaveText(/^1 \//); // column 2 snaps back to page 1
    const fullSteps = Number((await indicator.textContent())!.split('/')[1]);
    expect(fullSteps).toBeLessThanOrEqual(halfSteps);
    await page.keyboard.press('PageDown');
    await expect(indicator).toHaveText(/^2 \//);
    // A whole screen: two columns.
    expect(await shift()).toBeCloseTo(half * 2, 0);

    await page.reload();
    await expect(page.locator('.page-turn-btn')).toHaveText('Full page');
  });

  test('the turn toggle shows only in paged Perform', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('long-song');
    await expect(page.locator('.page-turn-btn')).toBeVisible();
    await sv.setMode('edit');
    await expect(page.locator('.page-turn-btn')).toBeHidden();
  });
  test('header controls are finger-sized (44px)', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('long-song');
    const targets = page.locator('.mode-switch-btn, .display-row .action-button');
    const shown = (els: Element[]) => els.filter((e) => e.getClientRects().length).map((e) => e.getBoundingClientRect().toJSON());
    for (const box of await targets.evaluateAll(shown)) {
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe('song view — Perform without touch', () => {
  test.use({ viewport: { width: 900, height: 420 }, hasTouch: false });

  test('stays a scrolling page on a pointer-only screen', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('long-song');
    await expect(page.locator('.page-indicator')).toBeHidden();
    await expect(page.locator('.page-turn-btn')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(420);
  });
});
