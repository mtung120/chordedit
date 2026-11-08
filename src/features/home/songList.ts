/**
 * Home page (/music/songs) — search + artist / tag filters + pagination +
 * Recently Played. Search matches titles and artists.
 *
 * Reads template-injected globals (window.songData / tagConfig / recentSongs)
 * once at mount and never touches them again. URLs come from ROUTES.
 *
 * While there's a query, `body.home-searching` hides everything but the
 * matches (the tag filter doesn't apply), and each change dispatches
 * `songsearch:change` ({ query, matches }) for the add-song flow below
 * the list (addSong.ts).
 */

import { ROUTES } from '../../routes.js';
import type { SongInfo, TagConfig } from '../../api/types.js';
import { matchesTag } from '../../utils/tags.js';
import { foldDiacritics } from '../../utils/text.js';
import { ArtistPicker, NO_ARTIST, type ArtistCount } from './artistPicker.js';

declare global {
  interface Window {
    songData?: SongInfo[];
    tagConfig?: TagConfig;
    recentSongs?: SongInfo[];
  }
}

const PAGE_SIZE = 20;

const tagConfig = (): TagConfig => window.tagConfig ?? { groups: [], implies: {}, auto: [] };

/** Icons for the derived tags (16px, stroke = currentColor). */
const AUTO_TAG_ICONS: Record<string, string> = {
  // A beamed pair of notes: the song has audio.
  Audio:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M6 12V3.5l7-1.5v8.5"/><circle cx="4.25" cy="12" r="1.75"/><circle cx="11.25" cy="10.5" r="1.75"/></svg>',
  // Mixer faders: vocals and backing can be played separately.
  Stems:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">' +
    '<path d="M4 2v12M8 2v12M12 2v12"/><path d="M2.5 10h3M6.5 5h3M10.5 8h3" stroke-width="2.4"/></svg>',
};

const MIC_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">' +
  '<rect x="6" y="1.5" width="4" height="8" rx="2"/><path d="M3.75 7.5a4.25 4.25 0 0 0 8.5 0M8 11.75V14.5"/></svg>';
const CHEVRON_ICON =
  '<svg class="artist-filter-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M4 6l4 4 4-4"/></svg>';
const CLEAR_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">' +
  '<path d="M4 4l8 8M12 4l-8 8"/></svg>';

/** Every artist with their song count, most songs first, and the songs without one. */
function countArtists(songs: SongInfo[]): { artists: ArtistCount[]; withoutArtist: number } {
  const counts = new Map<string, number>();
  let withoutArtist = 0;
  for (const song of songs) {
    if (song.artists.length === 0) withoutArtist++;
    for (const a of song.artists) counts.set(a, (counts.get(a) ?? 0) + 1);
  }
  const artists = [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'vi'));
  return { artists, withoutArtist };
}

/** Every filter tag: the ones users set, then the derived ones. */
const filterTags = (): string[] => [...tagConfig().groups.flat(), ...tagConfig().auto];

class SongListView {
  private activeTag: string | null = null;
  /** null = every artist; NO_ARTIST = songs without one. */
  private activeArtist: string | null = null;
  private searchQuery = '';
  private currentPage = 1;

  private readonly listEl = document.querySelector<HTMLElement>('.song-list');
  private readonly countEl = document.querySelector<HTMLElement>('.song-count');
  private readonly paginationEl = document.querySelector<HTMLElement>('.pagination');
  private readonly searchEl = document.querySelector<HTMLInputElement>('.song-search');
  private readonly tagBar = document.querySelector<HTMLElement>('.tag-filter-bar');
  private readonly artistPicker = new ArtistPicker((artist) => {
    this.activeArtist = artist;
    this.currentPage = 1;
    this.updateUrl();
    this.render();
  });

  init(): void {
    // Pre-select filters from the URL, e.g. ?tag=Verified&artist=Hoàng Dũng
    // (an empty ?artist= is "No artist").
    const params = new URLSearchParams(window.location.search);
    const urlTag = params.get('tag');
    if (urlTag && filterTags().includes(urlTag)) {
      this.activeTag = urlTag;
    }
    this.activeArtist = params.get('artist');

    const clearBtn = document.querySelector<HTMLButtonElement>('.song-search-clear');
    this.searchEl?.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      this.searchQuery = target.value;
      this.currentPage = 1;
      if (clearBtn) clearBtn.hidden = target.value === '';
      this.render();
    });
    clearBtn?.addEventListener('click', () => {
      if (!this.searchEl) return;
      this.searchEl.value = '';
      this.searchEl.dispatchEvent(new Event('input'));
      this.searchEl.focus();
    });

    this.renderRecent();
    this.render();
  }

  private updateUrl(): void {
    const url = new URL(window.location.href);
    if (this.activeTag) url.searchParams.set('tag', this.activeTag);
    else url.searchParams.delete('tag');
    if (this.activeArtist !== null) url.searchParams.set('artist', this.activeArtist);
    else url.searchParams.delete('artist');
    window.history.replaceState({}, '', url);
  }

  /** The Artist chip: "Artist ▾" opens the picker; once set, the name and a ×. */
  private buildArtistChip(): HTMLElement {
    const openPicker = (opener: HTMLElement) => {
      if (this.artistPicker.isOpen()) {
        this.artistPicker.close();
        return;
      }
      const { artists, withoutArtist } = countArtists(window.songData ?? []);
      this.artistPicker.open(artists, withoutArtist, this.activeArtist, opener);
    };

    if (this.activeArtist === null) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tag-filter-btn artist-filter-btn';
      btn.setAttribute('aria-haspopup', 'dialog');
      btn.setAttribute('aria-expanded', 'false');
      btn.innerHTML = MIC_ICON;
      btn.append('Artist');
      btn.insertAdjacentHTML('beforeend', CHEVRON_ICON);
      btn.addEventListener('click', () => openPicker(btn));
      return btn;
    }

    const chip = document.createElement('span');
    chip.className = 'artist-filter-chip';
    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'artist-filter-name';
    name.setAttribute('aria-haspopup', 'dialog');
    name.setAttribute('aria-expanded', 'false');
    name.innerHTML = MIC_ICON;
    name.append(this.activeArtist === NO_ARTIST ? 'No artist' : this.activeArtist);
    name.addEventListener('click', () => openPicker(name));
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'artist-filter-clear';
    clear.setAttribute('aria-label', 'Clear artist filter');
    clear.innerHTML = CLEAR_ICON;
    clear.addEventListener('click', () => {
      this.activeArtist = null;
      this.currentPage = 1;
      this.updateUrl();
      this.render();
    });
    chip.append(name, clear);
    return chip;
  }

  private buildTagBar(): void {
    if (!this.tagBar) return;
    this.tagBar.innerHTML = '';

    const divider = document.createElement('span');
    divider.className = 'tag-filter-divider';
    divider.setAttribute('aria-hidden', 'true');
    this.tagBar.append(this.buildArtistChip(), divider);

    const allBtn = document.createElement('button');
    allBtn.className = 'tag-filter-btn' + (this.activeTag === null ? ' active' : '');
    allBtn.textContent = 'All';
    allBtn.addEventListener('click', () => {
      this.activeTag = null;
      this.currentPage = 1;
      this.updateUrl();
      this.render();
    });
    this.tagBar.appendChild(allBtn);

    for (const tag of filterTags()) {
      const btn = document.createElement('button');
      btn.className = 'tag-filter-btn' + (this.activeTag === tag ? ' active' : '');
      btn.innerHTML = AUTO_TAG_ICONS[tag] ?? '';
      btn.append(tag);
      btn.dataset.tag = tag;
      btn.addEventListener('click', () => {
        this.activeTag = this.activeTag === tag ? null : tag;
        this.currentPage = 1;
        this.updateUrl();
        this.render();
      });
      this.tagBar.appendChild(btn);
    }
  }

  private renderRecent(): void {
    const row = document.querySelector<HTMLElement>('.recent-row');
    if (!row) return;
    row.innerHTML = '';
    for (const song of window.recentSongs ?? []) {
      const a = document.createElement('a');
      a.href = ROUTES.song(song.name);
      a.className = 'recent-chip';
      a.textContent = song.title || song.name;
      row.appendChild(a);
    }
  }

  private isSearching(): boolean {
    return this.searchQuery.trim() !== '';
  }

  private filteredSongs(): SongInfo[] {
    const needle = foldDiacritics(this.searchQuery.trim().toLowerCase());
    // The filter bar is hidden while searching, so its filters don't apply.
    const searching = this.isSearching();
    const tag = searching ? null : this.activeTag;
    const artist = searching ? null : this.activeArtist;
    return (window.songData ?? []).filter((song) => {
      const haystack = foldDiacritics([song.title || song.name, ...song.artists].join(' ').toLowerCase());
      const matchesSearch = needle === '' || haystack.includes(needle);
      const tagged = tag === null || matchesTag([...song.tags, ...song.autoTags], tag, tagConfig());
      const byArtist =
        artist === null ||
        (artist === NO_ARTIST ? song.artists.length === 0 : song.artists.includes(artist));
      return matchesSearch && tagged && byArtist;
    });
  }

  private renderSongs(songs: SongInfo[]): void {
    if (!this.listEl) return;
    this.listEl.innerHTML = '';

    const start = (this.currentPage - 1) * PAGE_SIZE;
    const pageSongs = songs.slice(start, start + PAGE_SIZE);

    if (pageSongs.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'no-songs-container';
      const p = document.createElement('p');
      p.className = 'no-songs';
      p.textContent = this.isSearching()
        ? `No songs match “${this.searchQuery.trim()}”`
        : 'No songs match these filters.';
      empty.appendChild(p);
      this.listEl.appendChild(empty);
      return;
    }

    for (let idx = 0; idx < pageSongs.length; idx++) {
      const song = pageSongs[idx];
      if (!song) continue;

      const a = document.createElement('a');
      a.href = ROUTES.song(song.name);
      a.className = 'song-item';

      const num = document.createElement('span');
      num.className = 'song-number';
      num.textContent = String(start + idx + 1);

      // Title, then the artists: below it on phones, beside it elsewhere.
      const main = document.createElement('span');
      main.className = 'song-main';
      const name = document.createElement('span');
      name.className = 'song-name';
      name.textContent = song.title || song.name;
      main.append(name);
      if (song.artists.length > 0) {
        const artists = document.createElement('span');
        artists.className = 'song-artist';
        artists.textContent = song.artists.join(', ');
        main.append(artists);
      }

      const tagsWrap = document.createElement('span');
      tagsWrap.className = 'song-tags';
      for (const tag of song.tags) {
        const chip = document.createElement('span');
        chip.className = 'song-tag';
        chip.textContent = tag;
        tagsWrap.appendChild(chip);
      }
      for (const tag of song.autoTags) {
        const icon = document.createElement('span');
        icon.className = 'song-tag-icon';
        icon.setAttribute('role', 'img');
        icon.setAttribute('aria-label', tag);
        icon.title = tag;
        icon.innerHTML = AUTO_TAG_ICONS[tag] ?? '';
        tagsWrap.appendChild(icon);
      }

      a.append(num, main, tagsWrap);
      this.listEl.appendChild(a);
    }
  }

  private renderPagination(total: number): void {
    if (!this.paginationEl) return;
    const totalPages = Math.ceil(total / PAGE_SIZE);
    this.paginationEl.innerHTML = '';
    if (totalPages <= 1) return;

    const makeBtn = (label: string, page: number, disabled: boolean, active: boolean) => {
      const btn = document.createElement('button');
      btn.className = 'page-btn' + (active ? ' active' : '');
      btn.textContent = label;
      btn.disabled = disabled;
      if (!disabled) {
        btn.addEventListener('click', () => {
          this.currentPage = page;
          this.render();
        });
      }
      return btn;
    };

    this.paginationEl.appendChild(
      makeBtn('←', this.currentPage - 1, this.currentPage === 1, false),
    );

    const start = Math.max(1, this.currentPage - 2);
    const end = Math.min(totalPages, start + 4);
    for (let p = start; p <= end; p++) {
      this.paginationEl.appendChild(makeBtn(String(p), p, false, p === this.currentPage));
    }

    this.paginationEl.appendChild(
      makeBtn('→', this.currentPage + 1, this.currentPage === totalPages, false),
    );
  }

  private render(): void {
    this.buildTagBar();
    const filtered = this.filteredSongs();
    const total = filtered.length;

    if (this.countEl) {
      this.countEl.textContent = `${total} song${total !== 1 ? 's' : ''}`;
    }

    this.renderSongs(filtered);
    this.renderPagination(total);

    document.body.classList.toggle('home-searching', this.isSearching());
    document.dispatchEvent(
      new CustomEvent('songsearch:change', {
        detail: { query: this.searchQuery.trim(), matches: total },
      }),
    );
  }
}

function mount(): void {
  if (!document.querySelector('.song-list')) return;
  new SongListView().init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
  mount();
}
