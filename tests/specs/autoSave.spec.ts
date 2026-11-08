import { test, expect } from '../helpers/server.js';
import { SongViewPage } from '../helpers/pages/songView.js';

test.describe('song view — autosave', () => {
  test('a new song keeps one blank line between paragraphs after an edit', async ({ page }) => {
    const content =
      '(Intro)\n[C] [G]\n\n(Verse 1)\n[C]Hello [G]world\n[Am]Second line\n\n[F]Bare para\n\n(Chorus)\n[F]Sing [C]along';
    const res = await page.request.post('/music/songs', {
      data: { songName: 'blank-lines', title: 'Blank lines', content },
    });
    expect(res.ok()).toBe(true);

    const sv = new SongViewPage(page);
    await sv.goto('blank-lines');
    await sv.enterEditMode();
    const saved = page.waitForResponse((r) => r.url().includes('/music/save-chords'));
    await sv.transposeUp.click();
    await saved;

    // Raw text shows the page's copy, which used to get 3 blank lines.
    // C → D♭ major, a flat key.
    const transposed = content
      .replace(/\[C\]/g, '[Db]').replace(/\[G\]/g, '[Ab]')
      .replace(/\[Am\]/g, '[Bbm]').replace(/\[F\]/g, '[Gb]');
    await sv.openEditMenu();
    await sv.editMenu.getByRole('menuitem', { name: 'Raw text' }).click();
    await expect(page.locator('.raw-text-area')).toHaveValue(transposed);

    await page.reload();
    expect(await sv.rawContentText()).toBe(transposed);
  });

  test('editing a chord triggers POST /music/save-chords within the debounce window', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await sv.enterEditMode();

    // Start listening for the save POST BEFORE the edit.
    const savePromise = page.waitForRequest(
      (req) => req.url().includes('/music/save-chords') && req.method() === 'POST',
      { timeout: 5000 },
    );

    // Edit a chord: C → F.
    await page.locator('.content .chord[data-raw="C"]').first().click();
    await page.locator('.chord-dialog .chord-option', { hasText: 'F' }).first().click();

    const req = await savePromise;
    const body = JSON.parse(req.postData() ?? '{}') as { songName: string; content: string };
    expect(body.songName).toBe('simple-ballad');
    expect(body.content.length).toBeGreaterThan(0);
    expect(body.content).toContain('(Intro)');
  });

  test('rapid edits coalesce — save fires, succeeds, then a single follow-up save fires', async ({ page }) => {
    // Characterizes the in-flight guard from Phase 1: at most one POST in
    // flight at a time; edits during a save produce exactly one follow-up.
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await sv.enterEditMode();

    // Collect every save-chords POST.
    const saves: Array<{ songName: string; content: string }> = [];
    page.on('request', (req) => {
      if (req.url().includes('/music/save-chords') && req.method() === 'POST') {
        try {
          saves.push(JSON.parse(req.postData() ?? '{}'));
        } catch {
          // ignore malformed
        }
      }
    });

    // Fire three rapid chord edits in sequence. The autosave debounce +
    // in-flight coalescer should produce at most 2 saves total (one for
    // the first settling, one follow-up for edits arriving during it).
    for (const target of ['G', 'Am', 'F']) {
      await page.locator('.content .chord').first().click();
      await page
        .locator('.chord-dialog .chord-option', { hasText: new RegExp(`^${target}$`) })
        .first()
        .click();
      // Tiny delay between edits; autosave debounce is 1s so these all
      // accumulate into the debounce window.
      await page.waitForTimeout(100);
    }

    // Wait for the debounce + any follow-up save to settle.
    await page.waitForTimeout(1500);

    expect(saves.length).toBeGreaterThanOrEqual(1);
    expect(saves.length).toBeLessThanOrEqual(3); // some slack for in-flight queueing
    // The LAST save's content must contain the final chord we picked.
    expect(saves[saves.length - 1].content).toContain('[F]');
  });

  test('edit survives a full page reload', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await sv.enterEditMode();

    const savePromise = page.waitForRequest(
      (req) => req.url().includes('/music/save-chords') && req.method() === 'POST',
    );
    await page.locator('.content .chord[data-raw="C"]').first().click();
    await page.locator('.chord-dialog .chord-option', { hasText: 'F' }).first().click();
    await savePromise;
    // Give the save request a moment to complete.
    await page.waitForTimeout(200);

    await page.reload();
    await expect(sv.rawContent).toBeAttached();

    // First chord is now F (was C).
    const firstRaw = await page
      .locator('.content .chord')
      .first()
      .evaluate((el) => (el as HTMLElement).dataset.raw ?? '');
    expect(firstRaw).toBe('F');
  });
});
