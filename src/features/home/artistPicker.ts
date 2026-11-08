/**
 * Artist filter picker on the home page (.artist-picker): a bottom sheet on
 * phones, a popover under the Artist chip elsewhere (CSS decides). Lists
 * every artist with their song count, most songs first, then "No artist".
 * Picking one calls `onPick` and closes.
 */
import { foldDiacritics } from '../../utils/text.js';

/** The "No artist" choice: songs without artists. */
export const NO_ARTIST = '';

export interface ArtistCount {
  name: string;
  count: number;
}

const CHECK =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7"/></svg>';

export class ArtistPicker {
  private readonly root = document.querySelector<HTMLElement>('.artist-picker');
  private readonly panel = this.root?.querySelector<HTMLElement>('.artist-picker-panel') ?? null;
  private readonly search = this.root?.querySelector<HTMLInputElement>('.artist-search') ?? null;
  private readonly list = this.root?.querySelector<HTMLElement>('.artist-list') ?? null;

  private artists: ArtistCount[] = [];
  private withoutArtist = 0;
  private selected: string | null = null;
  private opener: HTMLElement | null = null;

  constructor(private readonly onPick: (artist: string) => void) {
    this.root
      ?.querySelector('.artist-picker-close')
      ?.addEventListener('click', () => this.close());
    this.search?.addEventListener('input', () => this.renderList());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen()) this.close();
    });
    // A click outside the panel (the phone backdrop, or anywhere on desktop)
    // closes it; the opener toggles it itself.
    document.addEventListener('click', (e) => {
      const target = e.target as Node;
      if (!this.isOpen() || this.panel?.contains(target) || this.opener?.contains(target)) return;
      this.close();
    });
  }

  isOpen(): boolean {
    return !!this.root && !this.root.hidden;
  }

  open(artists: ArtistCount[], withoutArtist: number, selected: string | null, opener: HTMLElement): void {
    if (!this.root) return;
    this.artists = artists;
    this.withoutArtist = withoutArtist;
    this.selected = selected;
    this.opener = opener;
    if (this.search) this.search.value = '';
    this.renderList();
    this.root.hidden = false;
    opener.setAttribute('aria-expanded', 'true');
    // The keyboard would cover half a phone's sheet; focus only with a mouse.
    if (window.matchMedia('(pointer: fine)').matches) this.search?.focus();
  }

  close(): void {
    if (!this.root || this.root.hidden) return;
    this.root.hidden = true;
    this.opener?.setAttribute('aria-expanded', 'false');
  }

  private renderList(): void {
    if (!this.list) return;
    this.list.innerHTML = '';
    const needle = foldDiacritics((this.search?.value ?? '').trim().toLowerCase());
    const matches = (name: string) => foldDiacritics(name.toLowerCase()).includes(needle);

    for (const a of this.artists) {
      if (matches(a.name)) this.list.append(this.option(a.name, a.count, a.name));
    }
    if (this.withoutArtist > 0 && matches('No artist')) {
      const none = this.option('No artist', this.withoutArtist, NO_ARTIST);
      none.classList.add('artist-option-none');
      this.list.append(none);
    }
    if (!this.list.childElementCount) {
      const empty = document.createElement('p');
      empty.className = 'artist-list-empty';
      empty.textContent = 'No artist matches.';
      this.list.append(empty);
    }
  }

  private option(label: string, count: number, value: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'artist-option';
    if (value === this.selected) btn.setAttribute('aria-current', 'true');

    const name = document.createElement('span');
    name.className = 'artist-option-name';
    name.textContent = label;
    const num = document.createElement('span');
    num.className = 'artist-option-count';
    num.textContent = String(count);
    const check = document.createElement('span');
    check.className = 'artist-option-check';
    if (value === this.selected) check.innerHTML = CHECK;

    btn.append(name, num, check);
    btn.addEventListener('click', () => {
      this.close();
      this.onPick(value);
    });
    return btn;
  }
}
