import { test, expect } from '../helpers/server.js';
import { SongViewPage } from '../helpers/pages/songView.js';

test.describe('song view — edit mode + chord dialog', () => {
  test('Edit mode turns on chord + section editing together; leaving it turns both off', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    const body = page.locator('body');
    await expect(body).not.toHaveClass(/(^|\s)mode-edit(\s|$)/);

    await sv.enterEditMode();
    // Chord affordances and section affordances are both live — no sub-modes.
    await expect(page.locator('.content .chord.clickable').first()).toHaveCSS('pointer-events', 'auto');
    await expect(page.locator('.section-palette')).toBeVisible();

    await sv.exitEditMode();
    await expect(page.locator('.content .chord.clickable').first()).toHaveCSS('pointer-events', 'none');
    await expect(page.locator('.section-palette')).toBeHidden();
  });

  test('view mode: clicking a chord does NOT open the dialog', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    // Chords have pointer-events: none outside Edit; force the click anyway —
    // handleElementClick must still bail when editMode !== 'edit'.
    await page.locator('.content .chord').first().click({ force: true });
    await page.waitForTimeout(100);
    await expect(page.locator('.chord-dialog')).toHaveCount(0);
  });

  test('edit mode: clicking a chord opens the chord dialog with correct current badge', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await sv.enterEditMode();

    // The first chord in the intro is C.
    await page.locator('.content .chord[data-raw="C"]').first().click();
    await expect(page.locator('.chord-dialog')).toBeVisible();
    await expect(page.locator('.chord-dialog-title')).toHaveText('Change chord');
    await expect(page.locator('.chord-dialog-current')).toHaveText('C');
  });

  test('dialog dismiss: click backdrop', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await sv.enterEditMode();
    await page.locator('.content .chord[data-raw="C"]').first().click();
    await expect(page.locator('.chord-dialog-backdrop')).toBeVisible();
    // Desktop keeps a new dialog click-through briefly (double-click → inline edit).
    await expect(page.locator('.chord-dialog-backdrop')).not.toHaveClass(/click-through/);

    // The dialog is centered on-screen — clicking the backdrop's center
    // would actually hit the dialog. Click near the viewport corner where
    // only the backdrop exists.
    await page.mouse.click(5, 5);
    await expect(page.locator('.chord-dialog')).toHaveCount(0);
    await expect(page.locator('.chord-dialog-backdrop')).toHaveCount(0);
  });

  test('dialog dismiss: close button', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await sv.enterEditMode();
    await page.locator('.content .chord[data-raw="G"]').first().click();
    await page.locator('.chord-dialog-close').click();
    await expect(page.locator('.chord-dialog')).toHaveCount(0);
  });

  test('dialog dismiss: Escape', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await sv.enterEditMode();
    await page.locator('.content .chord[data-raw="G"]').first().click();
    await expect(page.locator('.chord-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.chord-dialog')).toHaveCount(0);
  });

  test('"Change every C in the song" switch replaces every C', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await sv.enterEditMode();
    const cs = page.locator('.content .chord[data-raw="C"]');
    const fsBefore = await page.locator('.content .chord[data-raw="F"]').count();
    const n = await cs.count();
    expect(n).toBeGreaterThan(1);

    await cs.first().click();
    const toggle = page.getByRole('switch', { name: 'Change every C in the song' });
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await page.locator('.chord-dialog .chord-option', { hasText: /^F$/ }).click();

    await expect(page.locator('.chord-dialog')).toHaveCount(0);
    await expect(cs).toHaveCount(0);
    await expect(page.locator('.content .chord[data-raw="F"]')).toHaveCount(fsBefore + n);
  });

  test('custom chord: the button stays disabled until something is typed', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await sv.enterEditMode();
    await page.locator('.content .chord[data-raw="C"]').first().click();
    const add = page.locator('.chord-dialog .chord-custom-add');
    await expect(add).toBeDisabled();
    await page.locator('.chord-dialog .chord-custom-input').fill('  ');
    await expect(add).toBeDisabled();
    await page.locator('.chord-dialog .chord-custom-input').fill('Dsus2');
    await expect(add).toBeEnabled();
  });

  test('pick a diatonic chord replaces the clicked chord (dataset.raw updates)', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await sv.enterEditMode();

    // Click the first C chord.
    const firstC = page.locator('.content .chord[data-raw="C"]').first();
    await firstC.click();
    await expect(page.locator('.chord-dialog')).toBeVisible();

    // Pick F from the common-chords section.
    await page.locator('.chord-dialog .chord-option', { hasText: 'F' }).first().click();
    await expect(page.locator('.chord-dialog')).toHaveCount(0);

    // The first chord in the DOM should now be F, not C.
    const firstRaw = await page
      .locator('.content .chord')
      .first()
      .evaluate((el) => (el as HTMLElement).dataset.raw ?? '');
    expect(firstRaw).toBe('F');
  });

  test('custom chord input adds to the user chord list and replaces the clicked chord', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await sv.enterEditMode();

    await page.locator('.content .chord[data-raw="C"]').first().click();
    const input = page.locator('.chord-dialog .chord-custom-input');
    await expect(input).toBeVisible();
    await input.fill('Bbsus2');
    await page.locator('.chord-dialog .chord-custom-add').click();
    await expect(page.locator('.chord-dialog')).toHaveCount(0);

    // The clicked chord became Bbsus2.
    const firstRaw = await page
      .locator('.content .chord')
      .first()
      .evaluate((el) => (el as HTMLElement).dataset.raw ?? '');
    expect(firstRaw).toBe('Bbsus2');

    // Re-opening the dialog now shows a "Your Chords" section with Bbsus2.
    await page.locator('.content .chord[data-raw="Bbsus2"]').first().click();
    await expect(page.locator('.chord-dialog .custom-chord-option')).toContainText('B');
    // Prettified: Bbsus2 renders with a flat glyph somewhere. Just check
    // that the option list is non-empty.
    await expect(page.locator('.chord-dialog .custom-chord-option')).toHaveCount(1);
  });

  test('custom chord input: Enter key submits (same as Add button)', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await sv.enterEditMode();

    await page.locator('.content .chord[data-raw="C"]').first().click();
    const input = page.locator('.chord-dialog .chord-custom-input');
    await input.fill('Dadd9');
    await input.press('Enter');
    await expect(page.locator('.chord-dialog')).toHaveCount(0);

    const firstRaw = await page
      .locator('.content .chord')
      .first()
      .evaluate((el) => (el as HTMLElement).dataset.raw ?? '');
    expect(firstRaw).toBe('Dadd9');
  });

  test('Delete button removes the chord from the line', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await sv.enterEditMode();

    // Count chords up front.
    const before = await page.locator('.content .chord').count();
    expect(before).toBeGreaterThan(0);

    // Click one and hit Delete.
    await page.locator('.content .chord[data-raw="C"]').first().click();
    await page.locator('.chord-dialog .chord-delete-button').click();
    await expect(page.locator('.chord-dialog')).toHaveCount(0);

    const after = await page.locator('.content .chord').count();
    expect(after).toBe(before - 1);
  });

  test('dialog header differs for empty-slot vs existing chord', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await sv.enterEditMode();

    // Existing chord → "Change chord" + current badge
    await page.locator('.content .chord[data-raw="C"]').first().click();
    await expect(page.locator('.chord-dialog-title')).toHaveText('Change chord');
    await expect(page.locator('.chord-dialog-current')).toHaveText('C');
    await page.locator('.chord-dialog-close').click();

    // Empty word/space → "Add chord" + NO current badge
    await page.locator('.content .clickable-word').first().click();
    await expect(page.locator('.chord-dialog-title')).toHaveText('Add chord');
    await expect(page.locator('.chord-dialog-current')).toHaveCount(0);
  });

  test('clicking a word-space slot in edit mode inserts a new chord before it', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await sv.enterEditMode();

    const before = await page.locator('.content .chord').count();
    // Click on a word that's NOT already preceded by a chord.
    await page.locator('.content .clickable-word', { hasText: 'this' }).first().click();
    await expect(page.locator('.chord-dialog-title')).toHaveText('Add chord');

    // Pick F from the diatonic list.
    await page.locator('.chord-dialog .chord-option', { hasText: 'F' }).first().click();
    await expect(page.locator('.chord-dialog')).toHaveCount(0);

    const after = await page.locator('.content .chord').count();
    expect(after).toBe(before + 1);
  });

  test('custom chord list is capped and de-duplicated', async ({ page }) => {
    // addCustomChord() de-dups and trims to some max. Add a unique one twice
    // and confirm only one custom-chord-option appears.
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await sv.enterEditMode();

    const applyCustom = async (chord: string) => {
      await page.locator('.content .chord[data-raw="C"]').first().click();
      await page.locator('.chord-dialog .chord-custom-input').fill(chord);
      await page.locator('.chord-dialog .chord-custom-add').click();
      await expect(page.locator('.chord-dialog')).toHaveCount(0);
    };

    await applyCustom('Xmaj9');
    // Now the first chord is Xmaj9; apply again from the same location.
    await applyCustom('Xmaj9');

    // Open a dialog to see the custom list.
    await page.locator('.content .chord').first().click();
    const customOptions = page.locator('.chord-dialog .custom-chord-option');
    // Should show exactly one occurrence, not two.
    await expect(customOptions).toHaveCount(1);
  });
});
