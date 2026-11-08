import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Page Object Model for /music/song?songName=X.
 *
 * The page has three modes (body[data-mode]): Edit, Practice, Perform.
 * Songs open in Perform. The Display bar (version, font size, transpose)
 * is always shown, in every mode.
 */
export type SongMode = 'edit' | 'practice' | 'perform';

export class SongViewPage {
  readonly page: Page;

  readonly title: Locator;
  readonly rawContent: Locator;
  readonly content: Locator;

  readonly modeSwitch: Locator;
  readonly editPanel: Locator;
  readonly practicePanel: Locator;

  readonly displayBar: Locator;

  readonly editMenuBtn: Locator;
  readonly editMenu: Locator;
  readonly tagEditor: Locator;

  /** "90 BPM · 4/4" beside the title (Perform only). */
  readonly titleSummary: Locator;

  readonly saveIndicator: Locator;

  readonly transposeDown: Locator;
  readonly transposeUp: Locator;

  constructor(page: Page) {
    this.page = page;
    this.title = page.locator('#song-title-heading');
    this.rawContent = page.locator('#raw-content');
    this.content = page.locator('.content');

    this.modeSwitch = page.locator('.mode-switch');
    // Edit-mode ⋮ menu (Raw text, Tags…, Rename, Delete) — in the Display bar.
    this.editPanel = page.locator('.edit-actions');
    this.practicePanel = page.locator('.mode-panel[data-mode-panel="practice"]');

    this.displayBar = page.locator('.display-bar');

    this.editMenuBtn = page.locator('.edit-menu-btn');
    this.editMenu = page.locator('.edit-menu-dropdown');
    this.tagEditor = page.locator('.tag-editor');

    this.titleSummary = page.locator('.title-summary');

    this.saveIndicator = page.locator('.save-indicator');

    this.transposeDown = page.locator('[data-action="transposeDown"]');
    this.transposeUp = page.locator('[data-action="transposeUp"]');
  }

  /** Navigate to a song by slug. */
  async goto(slug: string): Promise<void> {
    await this.page.goto(`/music/song?songName=${encodeURIComponent(slug)}`);
    await expect(this.rawContent).toBeAttached();
  }

  modeButton(mode: SongMode): Locator {
    return this.page.locator(`.mode-switch-btn[data-mode="${mode}"]`);
  }

  /** Switch the page mode via the segmented control. */
  async setMode(mode: SongMode): Promise<void> {
    await this.modeButton(mode).click();
    await expect(this.page.locator('body')).toHaveAttribute('data-mode', mode);
  }

  /** Enter Edit mode (chord, section, play-style and paragraph editing). */
  async enterEditMode(): Promise<void> {
    await this.setMode('edit');
    await expect(this.page.locator('body')).toHaveClass(/(^|\s)mode-edit(\s|$)/);
  }

  /** Leave Edit mode for Perform. */
  async exitEditMode(): Promise<void> {
    await this.setMode('perform');
    await expect(this.page.locator('body')).not.toHaveClass(/(^|\s)mode-edit(\s|$)/);
  }

  /** Open the Edit-mode ⋮ menu (enters Edit mode first). */
  async openEditMenu(): Promise<void> {
    await this.enterEditMode();
    await this.editMenuBtn.click();
    await expect(this.editMenu).toBeVisible();
  }

  /** Read the current song body as serialized text (as the DOM renders it).
   * Use this in autosave round-trip tests. */
  async rawContentText(): Promise<string> {
    return (await this.rawContent.textContent()) ?? '';
  }

  /** Tap a section-palette chip (Edit mode), then the nth paragraph. */
  async applySectionType(type: string, paragraphIndex: number): Promise<void> {
    const chip = this.page.locator('.section-chip', { hasText: new RegExp(`^${type}$`) });
    await chip.click();
    await expect(chip).toHaveClass(/picked/);
    // A word in the paragraph: the pick must win over the chord dialog.
    await this.content.locator('.song-paragraph').nth(paragraphIndex).locator('.song-line').first().click();
    await expect(chip).not.toHaveClass(/picked/);
  }
}
