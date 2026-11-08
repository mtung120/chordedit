import { test, expect } from '../helpers/server.js';
import { SongViewPage } from '../helpers/pages/songView.js';

test.describe('spacing after header add/remove + exit edit mode', () => {
  test('adding a header and exiting edit mode fixes paragraph spacing', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('mixed-headers');

    // Measure spacing of the first headerless paragraph in view mode
    const secondPara = page.locator('.content .song-paragraph').nth(1);
    const marginViewBefore = await secondPara.evaluate(
      (el) => parseFloat(getComputedStyle(el).marginTop),
    );
    // This is a continuation paragraph — should have extra margin
    expect(marginViewBefore).toBeGreaterThan(5);

    // Enter edit mode, add a header to the second paragraph
    await sv.enterEditMode();
    await sv.applySectionType('Chorus', 1);

    // Exit edit mode — triggers re-render
    await sv.exitEditMode();

    // The paragraph now has a section header, so spacing should be smaller
    const marginViewAfter = await secondPara.evaluate(
      (el) => parseFloat(getComputedStyle(el).marginTop),
    );
    expect(marginViewAfter).toBeLessThan(marginViewBefore);
  });

  test('removing a header and exiting edit mode fixes paragraph spacing', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('mixed-headers');

    // First paragraph has "Intro" header — should have small/no margin
    const firstPara = page.locator('.content .song-paragraph').first();
    const marginViewBefore = await firstPara.evaluate(
      (el) => parseFloat(getComputedStyle(el).marginTop),
    );

    // Enter edit mode, remove the header through the inline text editor
    await sv.enterEditMode();
    await firstPara.locator('.chord').first().dblclick();
    const editor = page.locator('.inline-para-editor');
    await editor.fill((await editor.inputValue()).replace(/^\(Intro\)\n?/, ''));
    await editor.press('Control+Enter');
    await expect(firstPara.locator('.section-header')).toHaveCount(0);

    // Exit edit mode — triggers re-render
    await sv.exitEditMode();

    // Now it's a continuation paragraph — should have larger margin
    const marginViewAfter = await firstPara.evaluate(
      (el) => parseFloat(getComputedStyle(el).marginTop),
    );
    expect(marginViewAfter).toBeGreaterThanOrEqual(marginViewBefore);
  });
});
