/**
 * Book-style paging for Perform mode on wide touch screens (foldables,
 * tablets in landscape).
 *
 * styles.css gives `.content` the viewport's remaining height and lays
 * #songView out in fixed-height columns, two to a screen, so overflow
 * columns continue to the right instead of growing downward. This module
 * turns that strip into pages, turned by swipe, by tapping the left/right
 * third of the lyrics, or by arrow / PageUp / PageDown / Space (Bluetooth
 * page-turner pedals send these). Turns move a transform on #songView, so
 * the last, partly filled screen still aligns. Opened from a setlist, a turn
 * past the end opens the next song and a turn back from the start opens the
 * previous one (setlistContext's ‹ › links).
 *
 * Two turn sizes, picked with the Display row's toggle and remembered per
 * device: half (the default) moves one column, so the right column slides
 * to the left and the next one comes in beside it — press any time while
 * reading the right column; full moves a whole screen.
 *
 * Everywhere else (phones, desktop, Edit / Practice) it stays inert.
 */

// Keep in sync with the paged @media block in styles.css.
const PAGED_QUERY = '(min-width: 768px) and (orientation: landscape) and (pointer: coarse)';
const SWIPE_MIN_PX = 40;
const TAP_MAX_PX = 10;
const COLUMNS_PER_SCREEN = 2;
const SLIDE_MS = 300; // half turn
const FULL_SLIDE_MS = 250;
const FADE_MS = 250;
const TURN_KEY = 'chordedit.pageTurn';

type TurnSize = 'half' | 'full';

const media = window.matchMedia(PAGED_QUERY);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
/** Index of the column at the left edge of the screen. */
let column = 0;
let columnCount = 1;
let turnSize: TurnSize = loadTurnSize();
let indicator: HTMLElement | null = null;
let toggle: HTMLElement | null = null;
let toggleBtn: HTMLButtonElement | null = null;

function loadTurnSize(): TurnSize {
  try {
    return localStorage.getItem(TURN_KEY) === 'full' ? 'full' : 'half';
  } catch {
    return 'half';
  }
}

function saveTurnSize(): void {
  try {
    localStorage.setItem(TURN_KEY, turnSize);
  } catch {
    // Private mode / blocked storage: the choice lasts until reload.
  }
}

/** True while Perform is laid out as pages (wide touch screen). */
export function isPaged(): boolean {
  return media.matches && document.body.dataset.mode === 'perform';
}

function content(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.content');
}

function pageStrip(): HTMLElement | null {
  return document.getElementById('songView');
}

function columnGap(view: HTMLElement): number {
  return parseFloat(getComputedStyle(view).columnGap) || 0;
}

/** Distance between column starts: two columns and a gap fill the box. */
function columnStride(): number {
  const view = pageStrip();
  const box = content();
  if (!view || !box) return 0;
  return (box.clientWidth + columnGap(view)) / COLUMNS_PER_SCREEN;
}

function countColumns(): number {
  const view = pageStrip();
  const last = view?.lastElementChild;
  const step = columnStride();
  if (!view || !last || step <= 0) return 1;
  // Both rects carry the current transform, so their difference doesn't.
  const extent = last.getBoundingClientRect().right - view.getBoundingClientRect().left;
  return Math.max(1, Math.floor((extent - 1) / step) + 1);
}

/** Columns a turn moves. */
function turnStep(): number {
  return turnSize === 'half' ? 1 : COLUMNS_PER_SCREEN;
}

/** The left column of the last screen a turn can reach. */
function lastColumn(): number {
  if (turnSize === 'full') {
    return Math.floor((columnCount - 1) / COLUMNS_PER_SCREEN) * COLUMNS_PER_SCREEN;
  }
  return Math.max(0, columnCount - COLUMNS_PER_SCREEN);
}

function render(animate: boolean): void {
  const view = pageStrip();
  if (!view) return;
  if (!isPaged()) {
    view.style.transform = '';
    view.style.transition = '';
    if (indicator) indicator.hidden = true;
    if (toggle) toggle.hidden = true;
    return;
  }
  const ms = turnSize === 'half' ? SLIDE_MS : FULL_SLIDE_MS;
  view.style.transition = animate && !reducedMotion.matches ? `transform ${ms / 1000}s ease-out` : 'none';
  view.style.transform = column ? `translateX(${-column * columnStride()}px)` : '';
  const steps = lastColumn() / turnStep() + 1;
  if (indicator) {
    indicator.hidden = steps < 2;
    indicator.textContent = `${column / turnStep() + 1} / ${steps}`;
  }
  if (toggle && toggleBtn) {
    toggle.hidden = false;
    toggleBtn.textContent = turnSize === 'half' ? 'Half page' : 'Full page';
    toggleBtn.setAttribute('aria-label',
      `Page turn: ${turnSize === 'half' ? 'half page' : 'full page'}. Switch to ${turnSize === 'half' ? 'full' : 'half'} page`);
  }
}

/**
 * A white cover over the column a half turn brings in: it slides in with
 * that column, then fades, so the new column reads as freshly turned.
 */
function coverIncoming(dir: 1 | -1): void {
  const view = pageStrip();
  const box = content();
  if (!view || !box || reducedMotion.matches) return;
  const stride = columnStride();
  const width = stride - columnGap(view);
  const boxRect = box.getBoundingClientRect();
  const viewRect = view.getBoundingClientRect();
  const cover = document.createElement('div');
  cover.className = 'page-turn-cover';
  cover.style.left = `${boxRect.left + (dir > 0 ? stride : 0)}px`;
  cover.style.top = `${viewRect.top}px`;
  cover.style.width = `${width}px`;
  cover.style.height = `${viewRect.height}px`;
  document.body.appendChild(cover);
  const from = `translateX(${dir * stride}px)`;
  const slid = SLIDE_MS / (SLIDE_MS + FADE_MS);
  const anim = cover.animate([
    { transform: from, opacity: 1, easing: 'ease-out' },
    { transform: 'none', opacity: 1, offset: slid },
    { transform: 'none', opacity: 0 },
  ], { duration: SLIDE_MS + FADE_MS });
  const done = () => cover.remove();
  anim.onfinish = done;
  anim.oncancel = done;
}

/** Recount columns after anything that changes the layout; keep the place. */
function relayout(): void {
  if (!isPaged()) {
    column = 0;
    render(false);
    return;
  }
  columnCount = countColumns();
  column = snap(column);
  render(false);
}

/** The nearest reachable left column at or before `col`. */
function snap(col: number): number {
  const step = turnStep();
  return Math.max(0, Math.min(Math.floor(col / step) * step, lastColumn()));
}

/** The setlist's previous / next song link, when there is one. */
function setlistLink(dir: 'prev' | 'next'): HTMLAnchorElement | null {
  return document.querySelector<HTMLAnchorElement>(`.setlist-nav [data-dir="${dir}"][href]`);
}

function turn(dir: 1 | -1): void {
  const next = column + dir * turnStep();
  if (next < 0 || next > lastColumn()) {
    const link = setlistLink(dir < 0 ? 'prev' : 'next');
    if (link) window.location.assign(link.href);
    return;
  }
  column = next;
  render(true);
  if (turnSize === 'half') coverIncoming(dir);
}

function toggleTurnSize(): void {
  turnSize = turnSize === 'half' ? 'full' : 'half';
  saveTurnSize();
  column = snap(column);
  render(true);
}

function wireGestures(box: HTMLElement): void {
  let startX = 0;
  let startY = 0;
  let tracking = false;

  box.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    tracking = isPaged() && e.touches.length === 1 && !!t;
    if (!t) return;
    startX = t.clientX;
    startY = t.clientY;
  }, { passive: true });

  box.addEventListener('touchend', (e) => {
    if (!tracking || !isPaged()) return;
    tracking = false;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy)) {
      turn(dx < 0 ? 1 : -1);
    } else if (Math.abs(dx) <= TAP_MAX_PX && Math.abs(dy) <= TAP_MAX_PX) {
      const rect = box.getBoundingClientRect();
      const x = (t.clientX - rect.left) / rect.width;
      if (x > 2 / 3) turn(1);
      else if (x < 1 / 3) turn(-1);
    }
  });
}

function wireKeys(): void {
  document.addEventListener('keydown', (e) => {
    if (!isPaged() || e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
    let dir: 1 | -1 | 0 = 0;
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) dir = 1;
    else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) dir = -1;
    if (!dir) return;
    e.preventDefault();
    turn(dir);
  });
}

function mount(): void {
  const box = content();
  if (!box) return;

  indicator = document.createElement('div');
  indicator.className = 'page-indicator';
  indicator.setAttribute('aria-live', 'polite');
  indicator.hidden = true;
  document.body.appendChild(indicator);

  toggle = document.querySelector<HTMLElement>('.page-turn');
  toggleBtn = toggle?.querySelector<HTMLButtonElement>('.page-turn-btn') ?? null;
  toggleBtn?.addEventListener('click', () => {
    toggleTurnSize();
    // A pedal's Space must turn the page, not press the toggle again.
    toggleBtn?.blur();
  });

  wireGestures(box);
  wireKeys();

  // songView replaces #songView on every re-render (transpose, version).
  new MutationObserver(relayout).observe(box, { childList: true });
  new ResizeObserver(relayout).observe(box);
  media.addEventListener('change', relayout);
  document.addEventListener('songmode:change', () => {
    column = 0;
    relayout();
  });
  document.fonts?.ready.then(relayout);
  relayout();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
  mount();
}
