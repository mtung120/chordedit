import { test, expect } from '../helpers/server.js';
import { awaitStableRender } from '../helpers/visual.js';
import { SongViewPage } from '../helpers/pages/songView.js';

test.describe('visual: song view', () => {
  test('default Perform mode', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await awaitStableRender(page);
    await expect(page).toHaveScreenshot('song-default.png', { fullPage: true });
  });

  test('edit mode', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await sv.enterEditMode();
    await awaitStableRender(page);
    await expect(page).toHaveScreenshot('song-edit-mode.png', { fullPage: true });
  });

  test('chord dialog open', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await sv.enterEditMode();
    await page.locator('.content .chord[data-raw="C"]').first().click();
    await awaitStableRender(page);
    await expect(page).toHaveScreenshot('song-chord-dialog.png');
  });

  test('Edit ⋮ menu open', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await sv.openEditMenu();
    await awaitStableRender(page);
    await expect(page).toHaveScreenshot('song-edit-menu-open.png');
  });

  test('Practice mode', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await sv.setMode('practice');
    await awaitStableRender(page);
    await expect(page.locator('.song-header')).toHaveScreenshot('song-practice-header.png');
  });
});
