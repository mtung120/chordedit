/**
 * Version picker in the song page's Display bar.
 *
 * Renders `[Label ▾]`: the dropdown lists every version (switching navigates
 * to the same song with a different ?v=), then "+ New version" (copied from
 * the current one) and, on a non-default version, "Rename this version" and
 * "Delete this version".
 */

import {
  getSongVersions,
  createVersion,
  deleteVersion,
  saveVersionLabel,
} from '../../api/client.js';
import { ROUTES } from '../../routes.js';
import type { SongVersionInfo } from '../../api/types.js';
import { wirePopover } from '../../utils/popover.js';

function getCurrentSlug(): string | undefined {
  return window.songName;
}

function getCurrentVersion(): number {
  return window.songVersion ?? 0;
}

function button(className: string, text: string, label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = text;
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.addEventListener('click', onClick);
  return btn;
}

function render(container: HTMLElement, versions: SongVersionInfo[], currentVersion: number): void {
  const current = versions.find((v) => v.version === currentVersion) ?? versions[0];
  const currentLabel = current?.label ?? '';

  const wrap = document.createElement('div');
  wrap.className = 'version-picker';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'action-button version-picker-btn';
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-label', 'Version');
  const labelSpan = document.createElement('span');
  labelSpan.className = 'version-picker-label';
  labelSpan.textContent = currentLabel;
  trigger.append(labelSpan, ' ▾');

  const menu = document.createElement('div');
  menu.className = 'popover-menu version-menu';
  menu.setAttribute('role', 'menu');
  for (const v of versions) {
    const item = button('popover-item version-item', v.label, v.label, () => {
      if (v.version !== currentVersion) navigateToVersion(v.version);
    });
    item.setAttribute('role', 'menuitem');
    if (v.version === currentVersion) item.classList.add('version-item--active');
    menu.appendChild(item);
  }
  const action = (text: string, onClick: () => void, cls = ''): void => {
    const item = button(`popover-item popover-item--secondary ${cls}`.trim(), text, text, onClick);
    item.setAttribute('role', 'menuitem');
    menu.appendChild(item);
  };
  action('+ New version', () => void handleCreateVersion());
  if (current && current.version >= 1) {
    action('Rename this version', () => void handleRename(current, labelSpan));
    action('Delete this version', () => void handleDeleteVersion(current.version), 'popover-item--danger');
  }

  wrap.append(trigger, menu);
  wirePopover(trigger, menu);
  container.replaceChildren(wrap);
  // Perform shows the picker only for songs with several versions.
  container.toggleAttribute('data-many', versions.length > 1);
}

function navigateToVersion(version: number): void {
  const slug = getCurrentSlug();
  if (!slug) return;
  // Keep the setlist context (Prev/Next bar) when switching versions.
  const setlist = new URLSearchParams(window.location.search).get('setlist') ?? undefined;
  window.location.href = ROUTES.song(slug, { version, setlist });
}

async function handleCreateVersion(): Promise<void> {
  const slug = getCurrentSlug();
  if (!slug) return;

  const label = prompt('Version label (e.g., "Capo 3", "Simplified"):');
  if (label === null) return; // cancelled

  try {
    const result = await createVersion({
      songName: slug,
      fromVersion: getCurrentVersion(),
      label: label || undefined,
    });
    navigateToVersion(result.version);
  } catch (err) {
    console.error('Failed to create version:', err);
    alert('Failed to create version');
  }
}

async function handleDeleteVersion(version: number): Promise<void> {
  const slug = getCurrentSlug();
  if (!slug) return;

  if (!confirm('Delete this version? This cannot be undone.')) return;

  try {
    await deleteVersion(slug, version);
    navigateToVersion(0); // redirect to default
  } catch (err) {
    console.error('Failed to delete version:', err);
    alert('Failed to delete version');
  }
}

async function handleRename(v: SongVersionInfo, labelEl: HTMLElement): Promise<void> {
  const slug = getCurrentSlug();
  if (!slug) return;

  const input = prompt('Version label:', v.label);
  const newLabel = input?.trim().slice(0, 100);
  if (!newLabel || newLabel === v.label) return;

  try {
    await saveVersionLabel({ songName: slug, version: v.version, label: newLabel });
    v.label = newLabel;
    labelEl.textContent = newLabel;
    const item = labelEl.closest('.version-picker')?.querySelector('.version-item--active');
    if (item) item.textContent = newLabel;
  } catch (err) {
    console.error('Failed to save version label:', err);
    alert('Failed to rename version');
  }
}

async function init(): Promise<void> {
  const slug = getCurrentSlug();
  if (!slug) return;

  const container = document.querySelector<HTMLElement>('.version-selector');
  if (!container) return;

  try {
    const { versions } = await getSongVersions(slug);
    render(container, versions, getCurrentVersion());
  } catch (err) {
    console.error('Failed to load versions:', err);
    container.textContent = 'Failed to load versions';
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void init(), { once: true });
} else {
  void init();
}
