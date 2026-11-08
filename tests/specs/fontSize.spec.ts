import { test, expect } from '../helpers/server.js';
import { SongViewPage } from '../helpers/pages/songView.js';

const lyricSize = (page: import('@playwright/test').Page) =>
  page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('songView')!).fontSize));

test.describe('song view — fixed lyric size', () => {
  test('no font-size controls; lyrics are 16px on phones and 18px on desktop', async ({ page }) => {
    // A scale saved by the old A−/A+ buttons must not matter any more.
    await page.addInitScript(() => localStorage.setItem('songFontSize', '1.5'));
    const sv = new SongViewPage(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await sv.goto('simple-ballad');
    await expect(page.locator('#increaseFont, #decreaseFont')).toHaveCount(0);
    expect(await lyricSize(page)).toBe(16);

    await page.setViewportSize({ width: 1280, height: 800 });
    expect(await lyricSize(page)).toBe(18);
  });
});
