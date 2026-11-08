/**
 * The song page's Edit ⋮ menu actions (deleteSong, startInlineTitleRename),
 * bound through `data-action` click delegation.
 */

import { deleteSong, renameSong } from '../../api/client.js';
import { shortTitle } from '../../utils/text.js';

declare global {
  interface Window {
    /** Slug of the current song, set inline in song.html. */
    songName?: string;
  }
}

class FormManager {
  /** Delete the current song (confirm + DELETE /music/delete-song + redirect). */
  async deleteSong(): Promise<void> {
    if (!window.songName) {
      alert('Error: Song name not available');
      return;
    }
    if (!confirm('Are you sure you want to delete this song? This action cannot be undone.')) {
      return;
    }
    try {
      await deleteSong(window.songName);
      window.location.href = '/music/songs';
    } catch (err) {
      alert(`Error deleting song: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Start inline title editing on #song-title-heading. Called from the
   * Edit ⋮ menu's "Rename song" item (via data-action delegation).
   */
  startInlineTitleEdit(): void {
    const heading = document.getElementById('song-title-heading');
    if (!heading || !window.songName) return;
    if (heading.querySelector('input')) return; // already editing

    // The heading shows the title capped (shortTitle); data-title has it all.
    const currentTitle = heading.dataset.title ?? (heading.textContent ?? '').trim();
    const show = (title: string): void => {
      heading.textContent = shortTitle(title);
      heading.dataset.title = title;
      heading.title = title;
    };
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentTitle;
    input.className = 'title-inline-input';

    heading.textContent = '';
    heading.appendChild(input);
    input.focus();
    input.select();

    const songSlug = window.songName;
    let cancelled = false;

    const commit = async (): Promise<void> => {
      if (cancelled) return;
      const newTitle = input.value.trim();
      show(newTitle || currentTitle);
      if (!newTitle || newTitle === currentTitle) return;
      try {
        await renameSong({ songName: songSlug, newTitle });
      } catch (err) {
        show(currentTitle);
        alert(`Error renaming: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    input.addEventListener('blur', () => void commit());
    input.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Enter') {
        ke.preventDefault();
        input.blur();
      } else if (ke.key === 'Escape') {
        cancelled = true;
        show(currentTitle);
      }
    });
  }
}

/** Bind `data-action="..."` clicks to the corresponding form-manager method. */
function wireDelegation(manager: FormManager): void {
  const methods: Record<string, () => void | Promise<void>> = {
    deleteSong: () => manager.deleteSong(),
    startInlineTitleRename: () => manager.startInlineTitleEdit(),
  };

  document.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (!action) return;
    const fn = methods[action];
    if (!fn) return;
    e.preventDefault();
    void fn();
  });
}

function mount(): void {
  wireDelegation(new FormManager());
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
  mount();
}
