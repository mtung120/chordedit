import { test, expect } from '../helpers/server.js';
import { awaitStableRender } from '../helpers/visual.js';
import { SongViewPage } from '../helpers/pages/songView.js';
import { HomePage } from '../helpers/pages/home.js';
import { openPractice, stubAudioReady } from '../helpers/media.js';

test.describe('visual: element zooms', () => {
  test('a single chord chip', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await awaitStableRender(page);
    await expect(page.locator('.content .chord').first()).toHaveScreenshot('element-chord-chip.png');
  });

  test('a section-header pill', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await awaitStableRender(page);
    await expect(page.locator('.content .section-header').first()).toHaveScreenshot('element-section-header.png');
  });

  test('the mode switcher', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await sv.setMode('edit');
    await awaitStableRender(page);
    await expect(sv.modeSwitch).toHaveScreenshot('element-mode-switch.png');
  });

  test('the Display bar controls', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await sv.setMode('edit');
    await awaitStableRender(page);
    await expect(page.locator('.display-row')).toHaveScreenshot('element-display-row.png');
  });

  test('the Edit section palette', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('mixed-headers');
    await sv.enterEditMode();
    await awaitStableRender(page);
    await expect(page.locator('.section-palette')).toHaveScreenshot('element-section-palette.png');
  });

  test('the Practice controls (audio ready, pitch shifted)', async ({ page }) => {
    await stubAudioReady(page);
    const sv = new SongViewPage(page);
    await sv.goto('ConMuaNho');
    await openPractice(sv);
    await sv.practicePanel.locator('.ps-btn', { hasText: '+' }).click();
    await sv.practicePanel.getByLabel('Speed').fill('75');
    await awaitStableRender(page);
    await expect(sv.practicePanel.locator('.yt-controls')).toHaveScreenshot('element-practice-controls.png');
  });

  test('the site logo', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await awaitStableRender(page);
    await expect(home.logo).toHaveScreenshot('element-logo.png');
  });

  test('home page header (title + count)', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await awaitStableRender(page);
    await expect(page.locator('.song-list-header')).toHaveScreenshot('element-song-list-header.png');
  });
});
