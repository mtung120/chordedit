import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Page Object Model for /music/songs (the home / song-list page).
 *
 * Keep methods focused on *user-level* actions; assertions live in the
 * specs that know what they're verifying.
 */
export class HomePage {
  readonly page: Page;
  readonly searchBox: Locator;
  readonly songList: Locator;
  readonly songCount: Locator;
  readonly recentRow: Locator;
  readonly tagFilterBar: Locator;
  readonly pagination: Locator;
  readonly logo: Locator;

  constructor(page: Page) {
    this.page = page;
    this.searchBox = page.locator('.song-search');
    this.songList = page.locator('.song-list');
    this.songCount = page.locator('.song-count');
    this.recentRow = page.locator('.recent-row');
    this.tagFilterBar = page.locator('.tag-filter-bar');
    this.pagination = page.locator('.pagination');
    this.logo = page.locator('.site-logo').first();
  }

  async goto(): Promise<void> {
    await this.page.goto('/music/songs');
    await expect(this.page).toHaveTitle('Song Library');
  }

  songItems(): Locator {
    return this.songList.locator('a.song-item');
  }

  recentChips(): Locator {
    return this.recentRow.locator('a.recent-chip');
  }

  tagButton(label: string): Locator {
    return this.tagFilterBar.getByRole('button', { name: label, exact: true });
  }

  async search(query: string): Promise<void> {
    await this.searchBox.fill(query);
  }

  async clickTagFilter(label: string): Promise<void> {
    await this.tagButton(label).click();
  }

  async clickSongByName(name: string): Promise<void> {
    await this.songList.locator('a.song-item', { hasText: name }).first().click();
  }

  async getSongHrefs(): Promise<string[]> {
    return this.songItems().evaluateAll((els) =>
      els.map((a) => (a as HTMLAnchorElement).getAttribute('href') ?? ''),
    );
  }
}
