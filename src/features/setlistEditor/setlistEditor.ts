/**
 * Setlist editor — runs on /music/setlist?name=X.
 *
 * Reads the template-injected initial state (window.setlistInitial, etc.),
 * lets the user edit the name and reorder/add/remove songs, and auto-saves
 * on every change with a 1-second debounce. The current name is kept in
 * window.setlistOriginalName and updated atomically when the server-side
 * rename succeeds.
 *
 * Layout mirrors the home page (.song-list-container + .song-list-header +
 * .song-list) so styling stays consistent. Edit/View toggle gates the
 * destructive controls; new (unsaved) setlists open in edit mode so the
 * user can start adding songs immediately.
 *
 * Drag-and-drop reordering uses native HTML5 DnD on the .song-item rows.
 * Song picker reuses the diacritic-stripping normalizeText shape from the
 * home page's songList.
 */

import { ROUTES } from '../../routes.js';
import { saveSetlist, deleteSetlist } from '../../api/client.js';
import { invalidate as invalidateSetlistCache } from '../../state/setlistStore.js';
import type { Setlist, SongInfo } from '../../api/types.js';

declare global {
  interface Window {
    setlistOriginalName?: string;
    setlistInitial?: Setlist;
    setlistExists?: boolean;
  }
}

function normalizeText(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, (m) => (m === 'đ' ? 'd' : 'D'));
}

class SetlistEditor {
  private name: string;
  private songs: string[];
  private originalName: string;
  // Tracks whether the setlist has been persisted at least once. When false,
  // we don't send oldName to avoid an unnecessary no-op delete in
  // SaveAndMaybeRename. Once we save once, we start sending oldName so
  // renames go through atomically.
  private existsOnServer: boolean;

  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saveInFlight = false;
  private savePending = false;

  private readonly container: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly songsList: HTMLOListElement;
  private readonly songsCount: HTMLElement;
  private readonly addSongBtn: HTMLButtonElement;
  private readonly deleteBtn: HTMLButtonElement;
  private readonly indicator: HTMLElement;
  private readonly editToggle: HTMLButtonElement;

  // View mode hides all destructive controls. New (unsaved) setlists open
  // in edit mode so the user can start adding songs immediately; existing
  // setlists open in view mode to prevent accidental edits.
  private editMode: boolean;

  private readonly pickerOverlay: HTMLElement;
  private readonly pickerSearch: HTMLInputElement;
  private readonly pickerList: HTMLElement;
  private readonly pickerClose: HTMLButtonElement;

  private readonly allSongs: SongInfo[];
  private songTitleBySlug: Map<string, string>;

  constructor() {
    const initial = window.setlistInitial ?? { name: '', songs: [] };
    this.originalName = window.setlistOriginalName ?? initial.name ?? '';
    this.existsOnServer = window.setlistExists === true;
    this.name = initial.name || this.originalName;
    this.songs = [...(initial.songs ?? [])];

    this.allSongs = window.songData ?? [];
    this.songTitleBySlug = new Map(this.allSongs.map((s) => [s.name, s.title || s.name]));

    this.container = this.req<HTMLElement>('.setlist-editor-container');
    this.nameInput = this.req<HTMLInputElement>('.setlist-name-input');
    this.songsList = this.req<HTMLOListElement>('.setlist-songs-list');
    this.songsCount = this.req<HTMLElement>('.setlist-songs-count');
    this.addSongBtn = this.req<HTMLButtonElement>('.setlist-add-song-btn');
    this.deleteBtn = this.req<HTMLButtonElement>('.setlist-delete-btn');
    this.indicator = this.req<HTMLElement>('.setlist-save-indicator');
    this.editToggle = this.req<HTMLButtonElement>('.setlist-edit-toggle');

    // New setlists need editing immediately; existing ones default to view.
    this.editMode = !this.existsOnServer;

    this.pickerOverlay = this.req<HTMLElement>('.song-picker-overlay');
    this.pickerSearch = this.req<HTMLInputElement>('.song-picker-search');
    this.pickerList = this.req<HTMLElement>('.song-picker-list');
    this.pickerClose = this.req<HTMLButtonElement>('.song-picker-close');
  }

  private req<T extends Element>(sel: string): T {
    const el = document.querySelector<T>(sel);
    if (!el) throw new Error(`SetlistEditor: missing ${sel}`);
    return el;
  }

  init(): void {
    this.nameInput.value = this.name;
    this.applyMode();
    this.renderSongs();

    this.nameInput.addEventListener('input', () => {
      this.name = this.nameInput.value;
      this.scheduleSave();
    });

    this.editToggle.addEventListener('click', () => this.toggleMode());
    this.addSongBtn.addEventListener('click', () => this.openPicker());
    this.deleteBtn.addEventListener('click', () => this.confirmDelete());
    this.pickerClose.addEventListener('click', () => this.closePicker());
    this.pickerOverlay.addEventListener('click', (e) => {
      if (e.target === this.pickerOverlay) this.closePicker();
    });
    this.pickerSearch.addEventListener('input', () => this.renderPicker());
  }

  private toggleMode(): void {
    this.editMode = !this.editMode;
    this.applyMode();
    this.renderSongs();
  }

  private applyMode(): void {
    this.container.classList.toggle('view-mode', !this.editMode);
    this.container.classList.toggle('edit-mode', this.editMode);
    this.editToggle.textContent = this.editMode ? 'Done' : 'Edit';
    this.editToggle.setAttribute('aria-pressed', this.editMode ? 'true' : 'false');
    this.nameInput.readOnly = !this.editMode;
    this.addSongBtn.hidden = !this.editMode;
  }

  // ─── Songs list rendering and DnD ────────────────────────────────────────

  private renderSongs(): void {
    this.songsList.innerHTML = '';
    const n = this.songs.length;
    this.songsCount.textContent = `${n} song${n === 1 ? '' : 's'}`;
    if (this.songs.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'no-songs-container setlist-songs-empty';
      const msg = document.createElement('p');
      msg.className = 'no-songs';
      msg.textContent = this.editMode
        ? 'No songs yet. Use Add song to start.'
        : 'No songs in this setlist yet.';
      empty.appendChild(msg);
      this.songsList.appendChild(empty);
      return;
    }

    this.songs.forEach((slug, idx) => {
      const row = document.createElement('a');
      row.className = this.editMode ? 'song-item editing' : 'song-item';
      row.href = ROUTES.song(slug, { setlist: this.originalName });
      row.draggable = this.editMode;
      row.dataset.idx = String(idx);

      if (this.editMode) {
        const handle = document.createElement('span');
        handle.className = 'setlist-song-handle';
        handle.textContent = '⋮⋮';
        handle.setAttribute('aria-label', 'Drag to reorder');
        row.appendChild(handle);
      }

      const num = document.createElement('span');
      num.className = 'song-number';
      // Explicit text (home page uses a CSS counter via ::before; we set
      // textContent so this works inside an <ol> without the counter
      // context).
      num.textContent = String(idx + 1);

      const name = document.createElement('span');
      name.className = 'song-name';
      name.textContent = this.songTitleBySlug.get(slug) || slug;

      row.append(num, name);

      if (this.editMode) {
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'setlist-song-remove';
        removeBtn.setAttribute('aria-label', 'Remove from setlist');
        removeBtn.textContent = '✕';
        removeBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.songs.splice(idx, 1);
          this.renderSongs();
          this.scheduleSave();
        });
        row.appendChild(removeBtn);
        this.wireRowDnd(row);
      }

      this.songsList.appendChild(row);
    });
  }

  private dragSrcIdx: number | null = null;

  private wireRowDnd(row: HTMLAnchorElement): void {
    row.addEventListener('dragstart', (e) => {
      this.dragSrcIdx = Number(row.dataset.idx);
      row.classList.add('dragging');
      e.dataTransfer?.setData('text/plain', String(this.dragSrcIdx));
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      this.dragSrcIdx = null;
      this.songsList
        .querySelectorAll('.drop-over')
        .forEach((el) => el.classList.remove('drop-over'));
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      row.classList.add('drop-over');
    });
    row.addEventListener('dragleave', () => {
      row.classList.remove('drop-over');
    });
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('drop-over');
      const dst = Number(row.dataset.idx);
      const src = this.dragSrcIdx;
      if (src === null || Number.isNaN(dst) || src === dst) return;
      const moved = this.songs.splice(src, 1)[0];
      if (moved === undefined) return;
      this.songs.splice(dst, 0, moved);
      this.renderSongs();
      this.scheduleSave();
    });
  }

  // ─── Song picker modal ──────────────────────────────────────────────────

  private openPicker(): void {
    this.pickerSearch.value = '';
    this.renderPicker();
    this.pickerOverlay.hidden = false;
    this.pickerSearch.focus();
  }

  private closePicker(): void {
    this.pickerOverlay.hidden = true;
  }

  private renderPicker(): void {
    const needle = normalizeText(this.pickerSearch.value.toLowerCase());
    this.pickerList.innerHTML = '';
    const matches = this.allSongs.filter((s) => {
      const hay = normalizeText((s.title || s.name).toLowerCase());
      return needle === '' || hay.includes(needle);
    });
    if (matches.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'song-picker-empty';
      empty.textContent = 'No songs match.';
      this.pickerList.appendChild(empty);
      return;
    }
    for (const s of matches.slice(0, 100)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'song-picker-item';
      const alreadyIn = this.songs.includes(s.name);
      if (alreadyIn) btn.classList.add('already-added');
      btn.textContent = (s.title || s.name) + (alreadyIn ? '  (already added)' : '');
      btn.addEventListener('click', () => {
        this.songs.push(s.name);
        this.renderSongs();
        this.scheduleSave();
        this.closePicker();
      });
      this.pickerList.appendChild(btn);
    }
  }

  // ─── Save / rename ───────────────────────────────────────────────────────

  private scheduleSave(): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flush(), 1000);
  }

  private async flush(): Promise<void> {
    if (this.saveInFlight) {
      this.savePending = true;
      return;
    }
    if (!this.name.trim()) {
      this.setIndicator('Name required');
      return;
    }
    this.saveInFlight = true;
    this.setIndicator('Saving…');
    try {
      await saveSetlist({
        oldName: this.existsOnServer ? this.originalName : undefined,
        name: this.name,
        songs: this.songs,
      });

      if (this.existsOnServer && this.originalName && this.originalName !== this.name) {
        invalidateSetlistCache(this.originalName);
      }
      invalidateSetlistCache(this.name);

      if (this.name !== this.originalName) {
        const url = new URL(window.location.href);
        url.searchParams.set('name', this.name);
        window.history.replaceState({}, '', url.toString());
        this.originalName = this.name;
      }
      this.existsOnServer = true;
      this.setIndicator('Saved ✓');
      // Re-render rows so song-link hrefs pick up the (possibly renamed)
      // setlist for their `?setlist=` URL param.
      this.renderSongs();
    } catch (err) {
      console.error('saveSetlist failed', err);
      this.setIndicator('Save failed');
    } finally {
      this.saveInFlight = false;
      if (this.savePending) {
        this.savePending = false;
        void this.flush();
      }
    }
  }

  private indicatorTimer: ReturnType<typeof setTimeout> | null = null;
  private setIndicator(text: string): void {
    this.indicator.textContent = text;
    if (this.indicatorTimer) clearTimeout(this.indicatorTimer);
    if (text === 'Saved ✓') {
      this.indicatorTimer = setTimeout(() => {
        this.indicator.textContent = '';
      }, 2000);
    }
  }

  private async confirmDelete(): Promise<void> {
    if (!this.existsOnServer) {
      window.location.href = ROUTES.home;
      return;
    }
    if (!window.confirm(`Delete setlist "${this.originalName}"? This cannot be undone.`)) {
      return;
    }
    try {
      await deleteSetlist(this.originalName);
      window.location.href = ROUTES.home;
    } catch (err) {
      console.error('deleteSetlist failed', err);
      this.setIndicator('Delete failed');
    }
  }
}

function mount(): void {
  if (!document.querySelector('.setlist-editor-container')) return;
  new SetlistEditor().init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
  mount();
}
