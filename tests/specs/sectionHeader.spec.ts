import { test, expect } from '../helpers/server.js';
import { SongViewPage } from '../helpers/pages/songView.js';

const headerNames = (page: import('@playwright/test').Page) =>
  page.locator('.content .section-header-name').allTextContents();

test.describe('song view — section palette', () => {
  test('palette shows only in Edit mode', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    const palette = page.locator('.section-palette');
    await expect(palette).toBeHidden();

    await sv.enterEditMode();
    await expect(palette).toBeVisible();
    await expect(palette.locator('.section-chip')).toHaveText([
      'Intro', 'Verse', 'Pre', 'Chorus', 'Bridge', 'Solo', 'Rap', 'Outro',
    ]);

    await sv.setMode('practice');
    await expect(palette).toBeHidden();
  });

  test('no per-paragraph section / play style / delete controls', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('mixed-headers');
    await sv.enterEditMode();
    await expect(
      page.locator('.content .edit-chip, .content .section-header-delete, .content .section-delete-trigger'),
    ).toHaveCount(0);
  });

  test('tapping a type then a headerless paragraph adds the header and saves', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('mixed-headers');
    await sv.enterEditMode();

    const saveReq = page.waitForRequest((r) => r.url().includes('/music/save-chords'));
    await sv.applySectionType('Chorus', 1);
    await expect(page.locator('.content .song-paragraph').nth(1).locator('.section-header-name')).toHaveText('Chorus');
    const body = (await saveReq).postData() ?? '';
    expect(body).toContain('(Chorus)');
  });

  test('applying to a header replaces it and keeps the play style', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await sv.enterEditMode();

    // Give the first section a play style through its text.
    const first = page.locator('.content .song-paragraph').first();
    await first.locator('.section-header-name').dblclick();
    const editor = page.locator('.inline-para-editor');
    await editor.fill((await editor.inputValue()).replace(/^\(([^)]*)\)/, '($1{Soft})'));
    await editor.press('Control+Enter');
    await expect(first.locator('.section-header-playstyle')).toHaveText('Soft');

    await sv.applySectionType('Solo', 0);
    await expect(first.locator('.section-header-name')).toHaveText('Solo');
    await expect(first.locator('.section-header-playstyle')).toHaveText('Soft');
  });

  test('only Verse is numbered, in song order', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('mixed-headers'); // Intro, –, Verse 1, –
    await sv.enterEditMode();

    await sv.applySectionType('Verse', 3);
    expect(await headerNames(page)).toEqual(['Intro', 'Verse 1', 'Verse 2']);

    // A verse added earlier in the song pushes the later ones up.
    await sv.applySectionType('Verse', 1);
    expect(await headerNames(page)).toEqual(['Intro', 'Verse 1', 'Verse 2', 'Verse 3']);

    // Replacing a verse renumbers the rest; other types carry no number.
    await sv.applySectionType('Chorus', 2);
    expect(await headerNames(page)).toEqual(['Intro', 'Verse 1', 'Chorus', 'Verse 2']);
  });

  test('the "Pre" chip writes a Pre-Chorus header', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('mixed-headers');
    await sv.enterEditMode();
    await sv.applySectionType('Pre', 1);
    expect(await headerNames(page)).toEqual(['Intro', 'Pre-Chorus', 'Verse 1']);
  });

  test('a picked chip wins over the chord dialog, then un-picks', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('mixed-headers');
    await sv.enterEditMode();

    await sv.applySectionType('Bridge', 1);
    await expect(page.locator('.chord-dialog')).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveClass(/section-picking/);

    // One header per pick: the next word tap opens the chord dialog again.
    await page.locator('.content .song-paragraph').nth(3).locator('.clickable-word').first().click();
    await expect(page.locator('.chord-dialog')).toBeVisible();
    expect(await headerNames(page)).toEqual(['Intro', 'Bridge', 'Verse 1']);
  });

  test('tapping the chip again, Escape, or a tap outside the lyrics drops the pick', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('mixed-headers');
    await sv.enterEditMode();
    const chip = page.locator('.section-chip', { hasText: /^Solo$/ });
    const body = page.locator('body');

    await chip.click();
    await expect(body).toHaveClass(/section-picking/);
    await chip.click();
    await expect(chip).not.toHaveClass(/picked/);
    await expect(body).not.toHaveClass(/section-picking/);

    await chip.click();
    await page.keyboard.press('Escape');
    await expect(chip).not.toHaveClass(/picked/);

    // Picking another chip moves the pick.
    await chip.click();
    const outro = page.locator('.section-chip', { hasText: /^Outro$/ });
    await outro.click();
    await expect(chip).not.toHaveClass(/picked/);
    await expect(outro).toHaveClass(/picked/);

    await page.locator('.song-title').click();
    await expect(outro).not.toHaveClass(/picked/);
    expect(await headerNames(page)).toEqual(['Intro', 'Verse 1']);
  });

  test('a pick times out after 3s of no activity; scrolling restarts the wait', async ({ page }) => {
    await page.clock.install();
    const sv = new SongViewPage(page);
    await sv.goto('mixed-headers');
    await sv.enterEditMode();
    const chip = page.locator('.section-chip', { hasText: /^Chorus$/ });

    await chip.click();
    await page.clock.runFor(2900);
    await expect(chip).toHaveClass(/picked/);
    await page.clock.runFor(200);
    await expect(chip).not.toHaveClass(/picked/);

    await chip.click();
    await page.clock.runFor(2000);
    await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
    await page.clock.runFor(2000);
    await expect(chip).toHaveClass(/picked/);
    await page.clock.runFor(1100);
    await expect(chip).not.toHaveClass(/picked/);
  });

  test('leaving Edit drops the pick', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('mixed-headers');
    await sv.enterEditMode();
    await page.locator('.section-chip', { hasText: /^Rap$/ }).click();
    await sv.setMode('perform');
    await expect(page.locator('body')).not.toHaveClass(/section-picking/);
  });

  for (const vp of [
    { name: 'phone', width: 390, height: 844, touch: true },
    { name: 'wide touch screen', width: 1024, height: 700, touch: true },
  ]) {
    test(`${vp.name}: the bar sits at the bottom and never covers the last section`, async ({ browser, baseURL }) => {
      const ctx = await browser.newContext({
        baseURL,
        viewport: { width: vp.width, height: vp.height },
        hasTouch: vp.touch,
        isMobile: vp.width < 768,
      });
      const page = await ctx.newPage();
      const sv = new SongViewPage(page);
      await sv.goto('simple-ballad');
      await sv.enterEditMode();
      const bar = (await page.locator('.section-palette').boundingBox())!;
      expect(Math.round(bar.y + bar.height)).toBe(vp.height);

      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const lowest = await page.evaluate(() =>
        Math.max(...[...document.querySelectorAll('.content .song-line')].map((l) => l.getBoundingClientRect().bottom)),
      );
      expect(lowest).toBeLessThanOrEqual(bar.y);

      // Taps (touch events) pick and apply, word included.
      await page.locator('.section-chip', { hasText: /^Outro$/ }).tap();
      const lastPara = page.locator('.content .song-paragraph').last();
      await lastPara.locator('.clickable-word').first().tap();
      await expect(lastPara.locator('.section-header-name')).toHaveText('Outro');
      await expect(page.locator('.chord-dialog')).toHaveCount(0);
      await ctx.close();
    });
  }

  test('desktop: the bar stays above the lyrics', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await sv.enterEditMode();
    const bar = (await page.locator('.section-palette').boundingBox())!;
    const first = (await page.locator('.content .song-paragraph').first().boundingBox())!;
    expect(bar.y + bar.height).toBeLessThanOrEqual(first.y);
  });

  test('legacy repeat-marker suffixes are ignored and not written back', async ({ page }) => {
    // repeat-brackets.txt still has "(Verse 1[rep-start])" / "(Verse 2[rep-end])".
    const sv = new SongViewPage(page);
    await sv.goto('repeat-brackets');
    expect(await headerNames(page)).toEqual(['Intro', 'Verse 1', 'Verse 1', 'Verse 2', 'Chorus']);

    // Any edit re-serializes the whole song: the markers must be gone.
    await sv.enterEditMode();
    const saveReq = page.waitForRequest((r) => r.url().includes('/music/save-chords'));
    await sv.transposeUp.click();
    const body = (await saveReq).postData() ?? '';
    expect(body).toContain('(Verse 1)');
    expect(body).not.toMatch(/rep-start|rep-end|volta-[12]/);
  });

  test('double-clicking a section header opens inline text editing', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await sv.enterEditMode();

    await page.locator('.content .section-header-name').first().dblclick();
    await expect(page.locator('.chord-dialog')).toHaveCount(0);
    await expect(page.locator('.inline-para-editor')).toBeVisible();
  });

  test('emptying a paragraph in the inline editor deletes it', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('mixed-headers');
    await sv.enterEditMode();

    const paragraphs = page.locator('.content .song-paragraph');
    await expect(paragraphs).toHaveCount(4);
    await paragraphs.nth(1).locator('.clickable-word').first().dblclick();
    await page.locator('.inline-para-editor').fill('');
    await page.locator('.inline-para-editor').press('Control+Enter');
    await expect(paragraphs).toHaveCount(3);
    expect(await sv.rawContentText()).not.toContain('no header at all');
  });
});
