import { test, expect } from '../helpers/server.js';
import { SongViewPage } from '../helpers/pages/songView.js';
import { openPractice, stubAudioReady } from '../helpers/media.js';

/**
 * Song page modes (src/features/songMode/songMode.ts): Edit / Practice /
 * Perform, the collapsible Display bar, and the Perform tempo summary.
 */
test.describe('song view — modes', () => {
  test('songs open in Perform with only the lyrics, Display controls and switcher', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'perform');
    await expect(sv.modeButton('perform')).toHaveAttribute('aria-selected', 'true');
    await expect(sv.editPanel).toBeHidden();
    await expect(sv.practicePanel.locator('.video-player-container')).not.toBeInViewport();
    await expect(sv.transposeUp).toBeVisible();
    await expect(page.locator('.raw-text-editor')).toBeHidden();
  });

  test('each mode shows only its own panel', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');

    await sv.setMode('edit');
    await expect(sv.editPanel).toBeVisible();
    await expect(sv.practicePanel.locator('.video-player-container')).not.toBeInViewport();
    await expect(page.locator('body')).toHaveClass(/(^|\s)mode-edit(\s|$)/);

    await sv.setMode('practice');
    await expect(sv.editPanel).toBeHidden();
    await expect(sv.practicePanel.locator('.video-player-container')).toBeVisible();
    await expect(page.locator('body')).not.toHaveClass(/(^|\s)mode-edit(\s|$)/);

    await sv.setMode('perform');
    await expect(sv.editPanel).toBeHidden();
    await expect(sv.practicePanel.locator('.video-player-container')).not.toBeInViewport();
  });

  test('Display controls show in every mode, with no collapse', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    for (const mode of ['perform', 'edit', 'practice'] as const) {
      await sv.setMode(mode);
      await expect(sv.transposeUp).toBeVisible();
      // One version: Perform leaves the picker out (see the test below).
      await expect(page.locator('.version-picker')).toBeVisible({ visible: mode !== 'perform' });
    }
  });

  test('the switcher sits on the title row, right-aligned, in every mode', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    const viewport = page.viewportSize()!;
    for (const mode of ['perform', 'edit', 'practice'] as const) {
      await sv.setMode(mode);
      const title = (await sv.title.boundingBox())!;
      const sw = (await sv.modeSwitch.boundingBox())!;
      expect(Math.abs(title.y + title.height / 2 - (sw.y + sw.height / 2))).toBeLessThan(sw.height / 2);
      expect(sw.x).toBeGreaterThan(title.x + title.width - 1);
      expect(viewport.width - (sw.x + sw.width)).toBeLessThan(60);
    }
  });

  test('the key shows between ♭ and ♯', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    const key = (await page.locator('.key-picker-btn').boundingBox())!;
    const down = (await sv.transposeDown.boundingBox())!;
    const up = (await sv.transposeUp.boundingBox())!;
    expect(down.x + down.width).toBeLessThanOrEqual(key.x + 1);
    expect(key.x + key.width).toBeLessThanOrEqual(up.x + 1);
    await expect(page.locator('.key-picker-btn')).toHaveText(/^Key\s*C/);
  });

  test('Perform shows the BPM and time signature beside the title', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad'); // BPM 90, 4/4
    await expect(sv.titleSummary).toHaveText('90 BPM');
    await expect(sv.titleSummary).toBeVisible();
    await sv.setMode('edit');
    await expect(sv.titleSummary).toBeHidden();
  });

  test('phones show the tempo after the Display controls instead of the title', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const mob = await ctx.newPage();
    const sv = new SongViewPage(mob);
    await sv.goto('simple-ballad');
    await expect(mob.locator('.display-tempo')).toHaveText('90 BPM');
    await expect(mob.locator('.display-tempo')).toBeVisible();
    await expect(sv.titleSummary).toBeHidden();
    // The song page shows the logo symbol alone.
    await expect(mob.locator('.song-top-bar .site-logo .logo-mark')).toBeVisible();
    await expect(mob.locator('.song-top-bar .site-logo')).toHaveAccessibleName('ChordEdit');
    await ctx.close();
  });

  test('leaving Practice pauses playback', async ({ page }) => {
    await stubAudioReady(page);
    const sv = new SongViewPage(page);
    await sv.goto('ConMuaNho');
    await openPractice(sv);
    const play = sv.practicePanel.locator('.yt-play-btn');
    await play.click();
    await expect(play).toHaveText('■');
    await sv.setMode('perform');
    await expect(play).toHaveText('▶');
  });

  test('version picker lists versions and the version actions', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await sv.setMode('edit');
    const picker = page.locator('.version-picker');
    await picker.locator('.version-picker-btn').click();
    const menu = picker.locator('.version-menu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('.version-item--active')).toHaveCount(1);
    await expect(menu.getByRole('menuitem', { name: '+ New version' })).toBeVisible();
    // Version 0 can't be renamed or deleted.
    await expect(menu.getByRole('menuitem', { name: 'Delete this version' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  });

  test('Perform shows the version picker only when the song has several versions', async ({ page }) => {
    const sv = new SongViewPage(page);
    const picker = page.locator('.version-selector');
    const versionsLoaded = page.waitForResponse((r) => r.url().includes('/music/song-versions'));
    await sv.goto('simple-ballad');
    await versionsLoaded;
    await expect(picker).toBeHidden();
    await sv.setMode('edit');
    await expect(picker).toBeVisible();

    const res = await page.request.post('/music/create-version', { data: { songName: 'simple-ballad', fromVersion: 0, label: 'Acoustic' } });
    expect(res.ok()).toBe(true);
    await sv.goto('simple-ballad');
    await expect(picker).toHaveAttribute('data-many', '');
    await expect(picker).toBeVisible();
  });

  test('the Tab feature is not shown', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await expect(page.locator('#songTab')).toHaveCount(0);
    await expect(page.locator('.tab-toolcard, .view-toggle')).toHaveCount(0);
  });
});

/**
 * Home Screen web app on a wide touch screen (foldable / tablet landscape):
 * the same layout as Safari, header row on top, menus opening downward.
 */
test('song view — the Home Screen app keeps the header row at the top', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1000, height: 720 }, hasTouch: true });
  await ctx.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
  const page = await ctx.newPage();
  const sv = new SongViewPage(page);
  await sv.goto('simple-ballad');

  const tab = sv.modeButton('edit');
  const box = (await tab.boundingBox())!;
  expect(box.y).toBeLessThan(60);

  await tab.tap();
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'edit');
  await page.locator('.edit-menu-btn').tap();
  const menu = (await page.locator('.edit-menu-dropdown').boundingBox())!;
  expect(menu.y).toBeGreaterThan(box.y);
  await ctx.close();
});
