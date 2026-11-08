import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { test, expect } from '../helpers/server.js';
import { SongViewPage } from '../helpers/pages/songView.js';

/** Collect raw chord attributes from every chord chip in the DOM, in order. */
async function collectRawChords(page: import('@playwright/test').Page): Promise<string[]> {
  return page.locator('.content .chord').evaluateAll(
    (els) => els.map((el) => (el as HTMLElement).dataset.raw ?? ''),
  );
}

/**
 * The Display bar's key: ♭ / ♯ and the key menu move every chord, spelled
 * for the new key (src/utils/chords.ts). Perform and Practice only change
 * the screen; Edit saves.
 */
test.describe('song view — key and transpose', () => {
  test('shows the detected key and moves it with ♭ / ♯', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad'); // C G Am F
    const key = page.locator('.key-picker-name');
    await expect(key).toHaveText('C');

    await sv.transposeUp.click();
    await expect(key).toHaveText('D♭');
    expect(new Set(await collectRawChords(page))).toEqual(new Set(['Db', 'Ab', 'Bbm', 'Gb']));

    await sv.transposeDown.click();
    await sv.transposeDown.click();
    await expect(key).toHaveText('B');
    expect(new Set(await collectRawChords(page))).toEqual(new Set(['B', 'F#', 'G#m', 'E']));
  });

  test('the key menu moves the song in one tap, spelled for the key', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('extended-chords'); // C, with D7/F#
    const before = await collectRawChords(page);
    await page.locator('.key-picker-btn').click();
    const menu = page.locator('.key-menu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('[aria-checked="true"]')).toContainText('C');
    await menu.getByRole('menuitemradio').filter({ hasText: 'E♭' }).click();

    await expect(menu).toBeHidden();
    await expect(page.locator('.key-picker-name')).toHaveText('E♭');
    const after = await collectRawChords(page);
    expect(after[before.indexOf('D7/F#')]).toBe('F7/A');
    expect(after[before.indexOf('Cmaj7')]).toBe('Ebmaj7');

    // Back to C: the same chords as before.
    await page.locator('.key-picker-btn').click();
    await menu.getByRole('menuitemradio').filter({ hasText: /^CAm$/ }).click();
    expect(await collectRawChords(page)).toEqual(before);
  });

  test('12 ♯ presses return to the original chords', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    const before = await collectRawChords(page);
    for (let i = 0; i < 12; i++) await sv.transposeUp.click();
    expect(await collectRawChords(page)).toEqual(before);
  });

  test('in Perform a key change is display only; Edit drops it', async ({ page, songsDir }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    const file = join(songsDir, 'simple-ballad.txt');
    const stored = await readFile(file, 'utf8');

    await sv.transposeUp.click();
    await sv.transposeUp.click();
    await expect(page.locator('.key-picker-name')).toHaveText('D');
    await page.waitForTimeout(1500); // longer than the auto-save delay
    expect(await readFile(file, 'utf8')).toBe(stored);

    // Practice keeps the shift; Edit shows the stored song.
    await sv.setMode('practice');
    await expect(page.locator('.key-picker-name')).toHaveText('D');
    await sv.setMode('edit');
    await expect(page.locator('.key-picker-name')).toHaveText('C');
    expect(new Set(await collectRawChords(page))).toEqual(new Set(['C', 'G', 'Am', 'F']));

    await page.reload();
    await expect(page.locator('.key-picker-name')).toHaveText('C');
  });

  test('in Edit a key change is saved', async ({ page, songsDir }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await sv.setMode('edit');
    await sv.transposeUp.click();
    await sv.transposeUp.click();
    await expect.poll(() => readFile(join(songsDir, 'simple-ballad.txt'), 'utf8')).toContain('[D]Hello [A]world');

    await page.reload();
    await expect(page.locator('.key-picker-name')).toHaveText('D');
  });

  test('in Edit "Wrong key? Set it" relabels the song and keeps the chords', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad'); // C G Am F, detected C
    const menu = page.locator('.key-menu');
    const setButton = menu.locator('.key-menu-set');

    // Not offered outside Edit.
    await page.locator('.key-picker-btn').click();
    await expect(setButton).toBeHidden();
    await page.keyboard.press('Escape');

    await sv.setMode('edit');
    const before = await collectRawChords(page);
    await page.locator('.key-picker-btn').click();
    await setButton.click();
    await expect(menu).toBeVisible();
    await expect(menu.locator('.key-menu-title')).toHaveText('The song is in');
    await expect(menu.locator('[aria-checked="true"]')).toHaveCount(0);
    await menu.getByRole('menuitemradio').filter({ hasText: /^GEm$/ }).click();

    await expect(menu).toBeHidden();
    await expect(page.locator('.key-picker-name')).toHaveText('G');
    expect(await collectRawChords(page)).toEqual(before);

    // Saved for the song: a reload shows G, and moves start from it.
    await expect.poll(async () => {
      await page.reload();
      return page.locator('.key-picker-name').textContent();
    }).toBe('G');
    await sv.transposeUp.click(); // G → A♭: every chord up one
    await expect(page.locator('.key-picker-name')).toHaveText('A♭');
    expect(new Set(await collectRawChords(page))).toEqual(new Set(['Db', 'Ab', 'Bbm', 'Gb']));

    // Reopening starts in moving again; Cancel leaves set mode.
    await sv.setMode('edit');
    await page.locator('.key-picker-btn').click();
    await expect(menu.locator('.key-menu-title')).toHaveText('Key');
    await setButton.click();
    await setButton.click();
    await expect(menu.locator('.key-menu-title')).toHaveText('Key');
  });
});
