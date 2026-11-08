import { test, expect } from '../helpers/server.js';
import { SongViewPage } from '../helpers/pages/songView.js';

test.describe('song view — rendering', () => {
  test('a wrapped lyric line hangs its continuation in; chords are not shifted', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const long = '[C]Một hai ba bốn năm sáu bảy tám chín mười mười một mười hai [G]cuối';
    const res = await page.request.post('/music/songs', {
      data: { songName: 'wrap-test', title: 'Wrap test', content: `(Verse 1)\n${long}\n[Am]Short line` },
    });
    expect(res.ok()).toBe(true);
    const sv = new SongViewPage(page);
    await sv.goto('wrap-test');

    const lines = page.locator('.content .song-line');
    await expect(lines).toHaveCount(2);
    const first = lines.first();
    const start = (await first.locator('.chord').first().boundingBox())!;
    const lastWord = (await first.locator('.clickable-word').last().boundingBox())!;
    const next = (await lines.nth(1).locator('.chord').boundingBox())!;
    expect(lastWord.y).toBeGreaterThan(start.y + 5); // it wrapped
    expect(lastWord.x).toBeGreaterThan(start.x + 10); // …and hangs in
    expect(Math.abs(next.x - start.x)).toBeLessThan(1); // new lines start flush
    // The chip's text sits inside its box (no inherited negative indent).
    const chip = first.locator('.chord').first();
    expect(await chip.evaluate((el) => getComputedStyle(el).textIndent)).toBe('0px');
  });

  test('title, raw content, and rendered paragraphs load for a simple song', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await expect(sv.title).toHaveText('Simple Ballad');
    const raw = await sv.rawContentText();
    expect(raw).toContain('(Intro)');
    expect(raw).toContain('[C]Hello');

    // Three source sections → three `.song-paragraph` blocks
    await expect(page.locator('.content .song-paragraph')).toHaveCount(3);
  });

  test('chord chips render with dataset.raw preserved', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');

    // Capture every chord's raw attribute; should match the set from the fixture.
    const raws = await page.locator('.content .chord').evaluateAll(
      (els) => els.map((el) => (el as HTMLElement).dataset.raw ?? ''),
    );
    // simple-ballad has C, G, Am, F across intro/verse/chorus
    expect(raws).toEqual(expect.arrayContaining(['C', 'G', 'Am', 'F']));
    // And no accidental empty entries
    expect(raws.every((r) => r.length > 0)).toBe(true);
  });

  test('section headers render as .section-header elements', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    const headers = await page.locator('.content .section-header').allTextContents();
    // Every paragraph starts with a bracketed header in the source.
    expect(headers.length).toBe(3);
    expect(headers[0]).toMatch(/Intro/i);
    expect(headers[1]).toMatch(/Verse/i);
    expect(headers[2]).toMatch(/Chorus/i);
  });

  test('Vietnamese diacritics render correctly in title and body', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('ConMuaNho');
    await expect(sv.title).toHaveText('Cơn Mưa Nhỏ');
    // Concatenated text is split at each chord chip — "trên [G]phố" renders
    // as "trên" + "G" + "phố" without a space after G. So assert a lyric
    // fragment that doesn't span a chord boundary.
    await expect(page.locator('.content')).toContainText('Cơn mưa rơi trên');
    await expect(page.locator('.content')).toContainText('không nguôi');
  });

  test('extended chords (maj7, slash, m7b5, dim7) all render', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('extended-chords');
    const raws = await page.locator('.content .chord').evaluateAll(
      (els) => els.map((el) => (el as HTMLElement).dataset.raw ?? ''),
    );
    expect(raws).toEqual(
      expect.arrayContaining(['Cmaj7', 'Dm7', 'Am7b5', 'D7/F#', 'Gsus4', 'Dim7', 'Faug', 'G13']),
    );
  });

  test('song header has the mode switcher and Display bar', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await expect(page.locator('.mode-switch-btn')).toHaveText(['Edit', 'Practice', 'Perform']);
    await expect(sv.displayBar).toBeVisible();
  });

  test('accessing a song updates recently-played on the home page', async ({ page }) => {
    // End-to-end: seeded clean .access_times.json, visit song, visit home,
    // see the chip. Effectively re-asserts the AccessTracker flow from the
    // Go side.
    const sv = new SongViewPage(page);
    await sv.goto('extended-chords');
    await expect(sv.title).toHaveText('Extended Chord Workout');

    await page.goto('/music/songs');
    const recentHrefs = await page.locator('.recent-row a.recent-chip').evaluateAll(
      (els) => els.map((a) => (a as HTMLAnchorElement).getAttribute('href') ?? ''),
    );
    expect(recentHrefs).toContain('/music/song?songName=extended-chords');
  });
});
