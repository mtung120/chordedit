/**
 * The Display bar's key menu, between ♭ and ♯: "Key G ▾" opens a 4 × 3 grid
 * of the 12 major keys, each with its relative minor below it (C over Am),
 * and picking one moves the song there (songView.moveToKey — saved only in
 * Edit). The label follows songView's `key:change`; a song without chords
 * shows "Key –" and the menu stays shut.
 *
 * Edit adds "Wrong key? Set it" for a misdetected key: the menu turns into
 * "The song is in", and the key picked next only relabels the song
 * (songView.relabelKey, saved for the song); the chords stay. Cancel, or
 * closing the menu, goes back to moving.
 */

import { KEY_NAMES, prettifyChord, spellNote } from '../../utils/chords.js';
import { wirePopover } from '../../utils/popover.js';

function mount(): void {
  const trigger = document.querySelector<HTMLButtonElement>('.key-picker-btn');
  const name = document.querySelector<HTMLElement>('.key-picker-name');
  const grid = document.querySelector<HTMLElement>('.key-menu-grid');
  const menu = document.querySelector<HTMLElement>('.key-menu');
  const title = menu?.querySelector<HTMLElement>('.key-menu-title');
  const hint = menu?.querySelector<HTMLElement>('.key-menu-hint');
  const setButton = menu?.querySelector<HTMLButtonElement>('.key-menu-set');
  if (!trigger || !name || !grid || !menu || !title || !hint || !setButton) return;

  let currentKey: number | null = null;
  let setting = false;
  const setSetting = (on: boolean): void => {
    setting = on;
    title.textContent = on ? 'The song is in' : 'Key';
    menu.setAttribute('aria-label', on ? 'The song is in' : 'Key');
    hint.textContent = on ? 'Chords stay as they are' : 'Moves every chord';
    setButton.textContent = on ? 'Cancel' : 'Wrong key? Set it';
    // While setting, no key is marked: the one shown is the doubtful one.
    items.forEach((item, i) => item.setAttribute('aria-checked', String(!on && i === currentKey)));
  };

  const items = KEY_NAMES.map((keyName, key) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'key-menu-item';
    item.setAttribute('role', 'menuitemradio');
    item.setAttribute('aria-checked', 'false');
    const major = document.createElement('span');
    major.className = 'key-menu-major';
    major.textContent = prettifyChord(keyName);
    const minor = document.createElement('span');
    minor.className = 'key-menu-minor';
    minor.textContent = prettifyChord(`${spellNote(key + 9, key)}m`);
    item.append(major, minor);
    item.addEventListener('click', () => {
      if (setting) window.songView?.relabelKey(key);
      else window.songView?.moveToKey(key);
      setSetting(false);
    });
    return item;
  });
  grid.replaceChildren(...items);
  // Opening the menu starts in moving; reset before wirePopover's toggle.
  trigger.addEventListener('click', () => setSetting(false));
  wirePopover(trigger, menu);
  setButton.addEventListener('click', (e) => {
    e.stopPropagation(); // a menu button, but this one keeps the menu open
    setSetting(!setting);
  });

  document.addEventListener('key:change', (e) => {
    const { key } = (e as CustomEvent<{ key: number | null }>).detail;
    currentKey = key;
    const label = key === null ? '–' : prettifyChord(KEY_NAMES[key]);
    name.textContent = label;
    trigger.disabled = key === null;
    trigger.setAttribute('aria-label', key === null ? 'Key' : `Key ${label}, change key`);
    items.forEach((item, i) => item.setAttribute('aria-checked', String(!setting && i === key)));
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
  mount();
}
