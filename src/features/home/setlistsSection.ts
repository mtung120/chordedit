/**
 * Setlists section on the home page (renders above the Song Library).
 *
 * Reads window.setlistsData (injected by handlers/home.go::GetHomePage)
 * and renders one row per setlist. "+ New setlist" prompts for a name and
 * navigates to /music/setlist?name=… — the editor handles first-save
 * creation, so we don't need a separate "create" round-trip.
 */

import { ROUTES } from '../../routes.js';
import type { Setlist } from '../../api/types.js';

declare global {
  interface Window {
    setlistsData?: Setlist[];
  }
}

function renderRow(sl: Setlist): HTMLAnchorElement {
  const a = document.createElement('a');
  a.className = 'setlist-row';
  a.href = ROUTES.setlist(sl.name);

  const name = document.createElement('span');
  name.className = 'setlist-row-name';
  name.textContent = sl.name;

  const meta = document.createElement('span');
  meta.className = 'setlist-row-meta';
  meta.textContent = `${sl.songs.length} song${sl.songs.length === 1 ? '' : 's'}`;

  a.append(name, meta);
  return a;
}

function mount(): void {
  const container = document.querySelector<HTMLElement>('.setlists-section');
  if (!container) return;

  container.innerHTML = '';

  const data = window.setlistsData ?? [];

  const header = document.createElement('div');
  header.className = 'setlists-section-header';

  const titleGroup = document.createElement('div');
  titleGroup.className = 'setlists-section-title-group';
  const title = document.createElement('h2');
  title.className = 'setlists-section-title';
  title.textContent = 'Setlists';
  const count = document.createElement('span');
  count.className = 'setlists-count';
  count.textContent = `${data.length} setlist${data.length === 1 ? '' : 's'}`;
  titleGroup.append(title, count);

  const newBtn = document.createElement('button');
  newBtn.type = 'button';
  newBtn.className = 'setlists-new-btn';
  newBtn.textContent = 'New setlist';
  newBtn.addEventListener('click', () => {
    const name = window.prompt('Setlist name (e.g. "Wedding May 2026")');
    if (!name || !name.trim()) return;
    window.location.href = ROUTES.setlist(name.trim());
  });
  header.append(titleGroup, newBtn);
  container.appendChild(header);

  const list = document.createElement('div');
  list.className = 'setlists-list';
  if (data.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'setlists-empty';
    empty.textContent = 'No setlists yet.';
    list.appendChild(empty);
  } else {
    for (const sl of data) {
      list.appendChild(renderRow(sl));
    }
  }
  container.appendChild(list);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
  mount();
}
