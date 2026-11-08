/**
 * Song page modes: Edit / Practice / Perform.
 *
 * Owns `body[data-mode]` (CSS shows only the active mode's panel), the
 * switcher on the title row, the Perform-mode tempo summary, and the Edit ⋮ menu. Songs open in Perform
 * (a new blank song: Edit, with Raw text open). Other modules hear about
 * switches via `songmode:change`.
 */

import { wirePopover } from '../../utils/popover.js';

export type SongMode = 'edit' | 'practice' | 'perform';

const MODES: readonly SongMode[] = ['edit', 'practice', 'perform'];

let mode: SongMode = 'perform';

// ─── Tempo summary ──────────────────────────────────────────────────────────

/** "90 BPM" beside the title, from the Practice panel's metronome (the time
 *  signature stays in Practice). */
function renderTempo(e: Event): void {
  const { bpm } = (e as CustomEvent<{ bpm: number | null }>).detail;
  const text = bpm ? `${bpm} BPM` : '';
  document.querySelectorAll<HTMLElement>('.tempo-summary').forEach((el) => {
    el.textContent = text;
  });
}

// ─── Mode switching ─────────────────────────────────────────────────────────

function setMode(next: SongMode): void {
  mode = next;
  document.body.dataset.mode = next;
  document.querySelectorAll<HTMLElement>('.mode-switch-btn').forEach((btn) => {
    btn.setAttribute('aria-selected', String(btn.dataset.mode === next));
  });
  window.songView?.setEditMode(next === 'edit' ? 'edit' : 'view');
  document.dispatchEvent(new CustomEvent('songmode:change', { detail: { mode: next } }));
}

function init(): void {
  document.querySelectorAll<HTMLElement>('.mode-switch-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.mode as SongMode;
      if (MODES.includes(next) && next !== mode) setMode(next);
    });
  });

  const menuBtn = document.querySelector<HTMLElement>('.edit-menu-btn');
  const menu = document.querySelector<HTMLElement>('.edit-menu-dropdown');
  if (menuBtn && menu) wirePopover(menuBtn, menu);
  document.querySelector('[data-action="toggleTags"]')?.addEventListener('click', () => {
    const tags = document.querySelector<HTMLElement>('.tag-editor');
    if (tags) tags.hidden = !tags.hidden;
  });

  document.addEventListener('metronome:change', renderTempo);

  // A new blank song (home page → Blank song) opens in Edit with Raw
  // text open; the flag is dropped so a reload opens it normally.
  const start = new URLSearchParams(window.location.search).get('edit');
  if (start) {
    // Edit the string: URLSearchParams would re-encode spaces as "+".
    const search = window.location.search.replace(/&edit=[^&]*/, '');
    window.history.replaceState({}, '', window.location.pathname + search);
  }
  setMode(start ? 'edit' : 'perform');
  if (start === 'raw') {
    document.querySelector<HTMLButtonElement>('[data-action="editRawText"]')?.click();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
