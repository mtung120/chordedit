/**
 * Adding songs from the home page's search field (replaces the old
 * /music/new-song page).
 *
 * Below the library matches (songList.ts, which reports each change as
 * `songsearch:change`):
 *   - a hopamchuan.com section. With no library match it searches by
 *     itself once typing stops for AUTO_SEARCH_DELAY_MS; otherwise it
 *     offers a "Search hopamchuan.com" row. Enter searches right away.
 *   - "Blank song": creates "New song XXXX" and opens it in Edit with
 *     Raw text open (rename it from the ⋮ menu).
 *
 * Tapping a result opens a preview sheet with the whole song and a
 * version switcher (best-scored first). Add creates the song; if the
 * library already has a song with that title (ignoring case, accents and
 * spaces), the version is added to it as a new version instead.
 */

import {
  createSong,
  createVersion,
  hopamchuanImport,
  hopamchuanSearch,
} from '../../api/client.js';
import type {
  HopamchuanImportVersion,
  HopamchuanSearchResult,
  SongInfo,
} from '../../api/types.js';
import { ROUTES } from '../../routes.js';
import { chordDisplayNodes } from '../../utils/chords.js';
import { slugFromTitle, titleKey } from '../../utils/text.js';
import { parseHeaderString } from '../songView/parser.js';

export const AUTO_SEARCH_DELAY_MS = 1000;
const MIN_AUTO_QUERY = 2;

const CHEVRON =
  '<svg class="add-song-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
const SEARCH_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const songs = (): SongInfo[] => window.songData ?? [];

/** The library song with the same title, if any. */
function findSameTitle(title: string): SongInfo | undefined {
  const key = titleKey(title);
  return songs().find((s) => titleKey(s.title || s.name) === key);
}

/** A slug no library song uses yet ("Dem Dong", then "Dem Dong 2", …). */
function freeSlug(base: string): string {
  const taken = new Set(songs().map((s) => s.name.toLowerCase()));
  let slug = base;
  for (let n = 2; taken.has(slug.toLowerCase()); n++) slug = `${base} ${n}`;
  return slug;
}

function randomTag(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 4; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

/** Song text → read-only preview: section headers, lines, chord chips. */
function renderSongPreview(target: HTMLElement, content: string): void {
  target.replaceChildren();
  const paragraphs = content.replace(/\r\n/g, '\n').trim().split(/\n\s*\n/);
  for (const para of paragraphs) {
    const block = el('div', 'pv-para');
    for (const raw of para.split('\n')) {
      let line = raw;
      const header = line.match(/^\s*\(([^)]*)\)\s*(.*)$/);
      if (header) {
        const { name } = parseHeaderString(header[1] ?? '');
        if (name.trim()) block.append(el('div', 'pv-header', name.trim()));
        line = header[2] ?? '';
      }
      if (!line.trim()) continue;
      const row = el('div', 'pv-line');
      line.split(/\[([^\]]*)\]/).forEach((part, i) => {
        if (i % 2) {
          const chord = el('span', 'pv-chord');
          chord.append(...chordDisplayNodes(part));
          row.append(chord);
        } else if (part) {
          row.append(part);
        }
      });
      block.append(row);
    }
    if (block.childNodes.length) target.append(block);
  }
}

class PreviewSheet {
  private readonly overlay = document.querySelector<HTMLElement>('.add-song-overlay');
  private readonly title = document.querySelector<HTMLElement>('.add-song-title');
  private readonly artist = document.querySelector<HTMLElement>('.add-song-artist');
  private readonly versionsBar = document.querySelector<HTMLElement>('.add-song-versions');
  private readonly prevBtn = document.querySelector<HTMLButtonElement>('.add-song-prev');
  private readonly nextBtn = document.querySelector<HTMLButtonElement>('.add-song-next');
  private readonly versionCount = document.querySelector<HTMLElement>('.add-song-version-count');
  private readonly versionLabel = document.querySelector<HTMLElement>('.add-song-version-label');
  private readonly preview = document.querySelector<HTMLElement>('.add-song-preview');
  private readonly note = document.querySelector<HTMLElement>('.add-song-note');
  private readonly status = document.querySelector<HTMLElement>('.add-song-status');
  private readonly confirmBtn = document.querySelector<HTMLButtonElement>('.add-song-confirm');

  private result: HopamchuanSearchResult | null = null;
  private existing: SongInfo | undefined;
  private versions: HopamchuanImportVersion[] = [];
  private index = 0;
  private busy = false;
  /** Bumped on every open/close so a late import response is ignored. */
  private seq = 0;
  private returnFocus: HTMLElement | null = null;

  constructor() {
    document.querySelector('.add-song-close')?.addEventListener('click', () => this.close());
    this.overlay?.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen()) this.close();
    });
    this.prevBtn?.addEventListener('click', () => this.show(this.index - 1));
    this.nextBtn?.addEventListener('click', () => this.show(this.index + 1));
    this.confirmBtn?.addEventListener('click', () => void this.confirm());
  }

  isOpen(): boolean {
    return !!this.overlay && !this.overlay.hidden;
  }

  async open(result: HopamchuanSearchResult, from: HTMLElement): Promise<void> {
    if (!this.overlay) return;
    const seq = ++this.seq;
    this.result = result;
    this.existing = findSameTitle(result.title);
    this.versions = [];
    this.index = 0;
    this.busy = false;
    this.returnFocus = from;

    if (this.title) this.title.textContent = result.title;
    if (this.artist) {
      this.artist.textContent = [result.artists.join(', '), 'hopamchuan.com'].filter(Boolean).join(' · ');
    }
    if (this.versionsBar) this.versionsBar.hidden = true;
    if (this.note) {
      this.note.hidden = !this.existing;
      if (this.existing) {
        const name = this.existing.title || this.existing.name;
        this.note.replaceChildren(
          'You already have ',
          el('b', '', name),
          ', so this is added to it as a new version.',
        );
      }
    }
    if (this.confirmBtn) {
      this.confirmBtn.textContent = this.existing ? 'Add as new version' : 'Add song';
      this.confirmBtn.disabled = true;
    }
    this.setStatus('');
    this.preview?.replaceChildren(el('p', 'add-song-loading', 'Loading the song…'));
    if (this.preview) this.preview.scrollTop = 0;

    this.overlay.hidden = false;
    document.body.classList.add('add-song-open');
    document.querySelector<HTMLElement>('.add-song-close')?.focus();

    try {
      const data = await hopamchuanImport({ songId: result.id, slug: result.slug });
      if (seq !== this.seq) return;
      this.versions = data.versions ?? [];
      if (this.versions.length === 0) {
        this.preview?.replaceChildren(el('p', 'add-song-loading', 'No chords found for this song.'));
        return;
      }
      this.show(0);
      if (this.confirmBtn) this.confirmBtn.disabled = false;
    } catch (err) {
      if (seq !== this.seq) return;
      this.preview?.replaceChildren(
        el('p', 'add-song-loading', `Couldn't load the song: ${err instanceof Error ? err.message : String(err)}`),
      );
    }
  }

  close(): void {
    if (!this.overlay || this.overlay.hidden) return;
    this.seq++;
    this.overlay.hidden = true;
    document.body.classList.remove('add-song-open');
    this.returnFocus?.focus();
  }

  private show(index: number): void {
    const v = this.versions[index];
    if (!v) return;
    this.index = index;
    const total = this.versions.length;
    if (this.versionsBar) this.versionsBar.hidden = total < 2;
    if (this.versionCount) this.versionCount.textContent = `Version ${index + 1} of ${total}`;
    if (this.versionLabel) {
      // hopamchuan's label is often the first lyric line, chords included.
      const label = v.label.replace(/\[[^\]]*\]/g, '');
      this.versionLabel.textContent = [v.isDefault ? 'Bản chính' : '', label]
        .filter(Boolean)
        .join(' · ');
    }
    if (this.prevBtn) this.prevBtn.disabled = index === 0;
    if (this.nextBtn) this.nextBtn.disabled = index === total - 1;
    if (this.preview) {
      renderSongPreview(this.preview, v.content);
      this.preview.scrollTop = 0;
    }
  }

  private async confirm(): Promise<void> {
    const v = this.versions[this.index];
    const result = this.result;
    if (!v || !result || this.busy) return;
    this.busy = true;
    if (this.confirmBtn) this.confirmBtn.disabled = true;
    this.setStatus('Adding…');
    try {
      if (this.existing) {
        const { version } = await createVersion({
          songName: this.existing.name,
          fromVersion: 0,
          content: v.content,
          label: 'hopamchuan',
        });
        window.location.href = ROUTES.song(this.existing.name, { version });
      } else {
        const slug = freeSlug(slugFromTitle(result.title) || `Song ${randomTag()}`);
        const name = await createSong({
          songName: slug,
          title: result.title,
          content: v.content,
          artists: result.artists,
        });
        window.location.href = ROUTES.song(name);
      }
    } catch (err) {
      this.busy = false;
      if (this.confirmBtn) this.confirmBtn.disabled = false;
      this.setStatus(`Couldn't add the song: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private setStatus(msg: string): void {
    if (this.status) this.status.textContent = msg;
  }
}

class AddSong {
  private readonly section = document.querySelector<HTMLElement>('.add-song');
  private readonly hac = document.querySelector<HTMLElement>('.hac-section');
  private readonly searchEl = document.querySelector<HTMLInputElement>('.song-search');
  private readonly sheet = new PreviewSheet();

  private query = '';
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped on every query change so a late search response is ignored. */
  private seq = 0;

  init(): void {
    document.addEventListener('songsearch:change', (e) => {
      const { query, matches } = (e as CustomEvent<{ query: string; matches: number }>).detail;
      this.onQuery(query, matches);
    });
    this.searchEl?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !this.query) return;
      e.preventDefault();
      void this.search();
    });
    document.querySelector('.blank-song-btn')?.addEventListener('click', (e) => {
      void this.addBlank(e.currentTarget as HTMLButtonElement);
    });
  }

  private onQuery(query: string, matches: number): void {
    if (query === this.query) return; // a page or tag change, not new typing
    this.query = query;
    this.seq++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.section) this.section.hidden = !query;
    if (!query) {
      this.hac?.replaceChildren();
      return;
    }
    if (matches === 0 && query.length >= MIN_AUTO_QUERY) {
      this.renderSearching();
      this.timer = setTimeout(() => void this.search(), AUTO_SEARCH_DELAY_MS);
    } else {
      this.renderOffer();
    }
  }

  private async search(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const q = this.query;
    const seq = ++this.seq;
    this.renderSearching();
    try {
      const results = await hopamchuanSearch(q);
      if (seq === this.seq) this.renderResults(results ?? []);
    } catch {
      if (seq === this.seq) this.renderError();
    }
  }

  /** "Search hopamchuan.com for “q”" — when the library already matched. */
  private renderOffer(): void {
    const btn = el('button', 'add-song-row hac-offer');
    btn.type = 'button';
    btn.innerHTML = `<span class="add-song-row-icon">${SEARCH_ICON}</span>`;
    const text = el('span', 'add-song-row-text');
    text.append(
      el('span', 'add-song-row-title', 'Search hopamchuan.com'),
      el('span', 'add-song-row-sub', `for “${this.query}”`),
    );
    btn.append(text);
    btn.insertAdjacentHTML('beforeend', CHEVRON);
    btn.addEventListener('click', () => void this.search());
    this.hac?.replaceChildren(btn);
  }

  private label(): HTMLElement {
    return el('div', 'search-label', 'hopamchuan.com');
  }

  private renderSearching(): void {
    const status = el('div', 'hac-status');
    status.setAttribute('role', 'status');
    status.append(el('span', 'hac-spinner'), 'Searching…');
    this.hac?.replaceChildren(this.label(), status);
  }

  private renderError(): void {
    const retry = el('button', 'hac-retry', 'Try again');
    retry.type = 'button';
    retry.addEventListener('click', () => void this.search());
    const status = el('div', 'hac-status');
    status.append("Couldn't reach hopamchuan.com. ", retry);
    this.hac?.replaceChildren(this.label(), status);
  }

  private renderResults(results: HopamchuanSearchResult[]): void {
    if (results.length === 0) {
      this.hac?.replaceChildren(
        this.label(),
        el('div', 'hac-status', `No songs found for “${this.query}”`),
      );
      return;
    }
    const list = el('div', 'hac-results');
    for (const r of results) {
      const btn = el('button', 'hac-result');
      btn.type = 'button';
      const text = el('span', 'hac-result-text');
      text.append(el('span', 'hac-result-title', r.title));
      if (r.artists.length) text.append(el('span', 'hac-result-artist', r.artists.join(', ')));
      btn.append(text);
      btn.insertAdjacentHTML('beforeend', CHEVRON);
      btn.addEventListener('click', () => void this.sheet.open(r, btn));
      list.append(btn);
    }
    this.hac?.replaceChildren(this.label(), list);
  }

  private async addBlank(btn: HTMLButtonElement): Promise<void> {
    btn.disabled = true;
    const title = `New song ${randomTag()}`;
    try {
      const name = await createSong({ songName: freeSlug(title), title, content: '' });
      window.location.href = ROUTES.song(name, { edit: 'raw' });
    } catch (err) {
      btn.disabled = false;
      alert(`Couldn't create the song: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function mount(): void {
  if (!document.querySelector('.add-song')) return;
  new AddSong().init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
  mount();
}
