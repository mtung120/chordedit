import { test, expect } from '../helpers/server.js';
import { SongViewPage } from '../helpers/pages/songView.js';

/**
 * Inline paragraph editing has fragile focus/blur handling — the textarea
 * auto-commits on blur, so any Playwright interaction that bounces focus
 * (e.g. a click that immediately follows another) collapses the editor
 * before the test can type into it. This is a real concern for the Stage 4
 * restructure: the autosave-on-blur should ideally be more deliberate.
 *
 * The tests below drive the editor via the exposed SongView instance
 * methods instead of clicking the UI, so we characterize the content-
 * serialization and re-parse behavior reliably while we still have the
 * god-object in place. Post-Stage 4, this can be rewritten against the
 * split editor module.
 */
test.describe('song view — inline paragraph edit (via SongView API)', () => {
  test('startInlineParagraphEdit exposes the paragraph source verbatim', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await sv.enterEditMode();

    const rawSource = await page.evaluate(() => {
      const view = (window as unknown as { songView: { serializeParagraph: (p: Element) => string } })
        .songView;
      const paragraphs = document.querySelectorAll('.content .song-paragraph');
      return view.serializeParagraph(paragraphs[1] as Element);
    });
    expect(rawSource).toContain('Verse 1');
    expect(rawSource).toContain('[C]Hello');
  });

  test('finishing an inline edit with new content re-parses the paragraph', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await sv.enterEditMode();

    // Drive the editor via a short JS routine that mimics the UI flow but
    // avoids focus races: open editor, replace value, simulate Ctrl+Enter.
    await page.evaluate(() => {
      const view = (
        window as unknown as {
          songView: {
            startInlineParagraphEdit: (p: Element) => void;
          };
        }
      ).songView;
      const paragraphs = document.querySelectorAll('.content .song-paragraph');
      view.startInlineParagraphEdit(paragraphs[1] as Element);
      const ta = document.querySelector('.inline-para-editor') as HTMLTextAreaElement;
      ta.value = '(Verse 1)\n[Bb]My edited paragraph';
      // Dispatch Ctrl+Enter to trigger the commit path without touching focus.
      ta.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    await expect(page.locator('.inline-para-editor')).toHaveCount(0);
    const newRaws = await page
      .locator('.content .song-paragraph')
      .nth(1)
      .locator('.chord')
      .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.raw ?? ''));
    expect(newRaws).toEqual(['Bb']);
    await expect(
      page.locator('.content .song-paragraph').nth(1).locator('.section-header-name'),
    ).toHaveText('Verse 1');
  });

  test('Escape keydown discards the edit', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await sv.enterEditMode();

    const originalRaws = await page
      .locator('.content .song-paragraph')
      .nth(1)
      .locator('.chord')
      .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.raw ?? ''));

    await page.evaluate(() => {
      const view = (
        window as unknown as {
          songView: { startInlineParagraphEdit: (p: Element) => void };
        }
      ).songView;
      const paragraphs = document.querySelectorAll('.content .song-paragraph');
      view.startInlineParagraphEdit(paragraphs[1] as Element);
      const ta = document.querySelector('.inline-para-editor') as HTMLTextAreaElement;
      ta.value = '(Verse 1)\n[Z]totally different';
      ta.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });

    await expect(page.locator('.inline-para-editor')).toHaveCount(0);
    const afterRaws = await page
      .locator('.content .song-paragraph')
      .nth(1)
      .locator('.chord')
      .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.raw ?? ''));
    expect(afterRaws).toEqual(originalRaws);
  });
});
