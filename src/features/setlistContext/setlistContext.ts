/**
 * Setlist navigation on the song page.
 *
 * Mounts on /music/song?songName=X when the URL also carries
 * `&setlist=Y`. Fetches setlist Y, locates X's position, and fills the
 * Display bar's `.setlist-nav` with the setlist name and position
 * ("Friday gig · 2/7", linking back to the setlist) and ‹ › links to the
 * previous / next song. Each link's href carries `&setlist=Y`, so moving
 * through the setlist keeps the context. songPager follows the same links
 * when a page turn goes past the first or last page.
 *
 * Silent no-op when there's no `setlist` param, when the setlist 404s,
 * or when the song isn't in the setlist. This is by design: the URL
 * is the only state, and a missing/stale param simply produces no UI.
 */

import { ROUTES } from '../../routes.js';
import { get as getSetlist } from '../../state/setlistStore.js';
import type { Setlist } from '../../api/types.js';

declare global {
  interface Window {
    songName?: string;
  }
}

const CHEVRON = {
  prev: 'M15 6l-6 6 6 6',
  next: 'M9 6l6 6-6 6',
};

function songLink(dir: 'prev' | 'next', slug: string | null, setlist: string): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = 'action-button';
  link.dataset.dir = dir;
  link.setAttribute('aria-label', dir === 'prev' ? 'Previous song' : 'Next song');
  link.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${CHEVRON[dir]}"/></svg>`;
  if (slug) link.href = ROUTES.song(slug, { setlist });
  else link.setAttribute('aria-disabled', 'true');
  return link;
}

function build(sl: Setlist, idx: number, nav: HTMLElement): void {
  const divider = document.createElement('span');
  divider.className = 'display-divider';
  divider.setAttribute('aria-hidden', 'true');

  const name = document.createElement('a');
  name.className = 'setlist-nav-name';
  name.href = ROUTES.setlist(sl.name);
  name.title = 'Back to setlist';
  const title = document.createElement('span');
  title.className = 'setlist-nav-title';
  title.textContent = sl.name;
  const pos = document.createElement('span');
  pos.className = 'setlist-nav-pos';
  pos.textContent = `\u00a0· ${idx + 1}/${sl.songs.length}`;
  name.append(title, pos);

  nav.replaceChildren(
    divider,
    name,
    songLink('prev', idx > 0 ? sl.songs[idx - 1]! : null, sl.name),
    songLink('next', idx < sl.songs.length - 1 ? sl.songs[idx + 1]! : null, sl.name),
  );
  nav.hidden = false;
}

async function mount(): Promise<void> {
  const nav = document.querySelector<HTMLElement>('.setlist-nav');
  if (!nav) return;

  const setlistName = new URLSearchParams(window.location.search).get('setlist');
  if (!setlistName) return;

  const songSlug = window.songName;
  if (!songSlug) return;

  const sl = await getSetlist(setlistName);
  if (!sl) return; // 404 or fetch error → silent no-op
  if (!sl.songs || sl.songs.length === 0) return;

  const idx = sl.songs.indexOf(songSlug);
  if (idx === -1) return; // song was removed from the setlist since the link was made

  build(sl, idx, nav);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void mount(), { once: true });
} else {
  void mount();
}
