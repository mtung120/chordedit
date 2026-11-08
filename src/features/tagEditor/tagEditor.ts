/**
 * Tag editor on the song view page (.tag-editor, opened from the Edit ⋮
 * menu). Chips with × to remove, a select to add a tag; adding one replaces
 * any other tag from its group (TagConfig). Every change saves immediately.
 */
import { getTagConfig, saveSongTags } from '../../api/client.js';
import type { TagConfig } from '../../api/types.js';
import { get as getSongMetaCached } from '../../state/songMetaStore.js';
import { withTag } from '../../utils/tags.js';

declare global {
  interface Window {
    songName?: string;
  }
}

class TagEditor {
  private currentTags: string[] = [];
  private config: TagConfig = { groups: [], implies: {}, auto: [] };

  constructor(private readonly container: HTMLElement) {}

  async init(): Promise<void> {
    try {
      this.config = await getTagConfig();
    } catch (err) {
      console.error('tagEditor: failed to load the tag config', err);
    }
    await this.loadFromMeta();
  }

  private async loadFromMeta(): Promise<void> {
    const known = this.config.groups.flat();
    try {
      const meta = await getSongMetaCached();
      // Retired tags would make the server reject the next save.
      this.currentTags = (meta.tags ?? []).filter((t) => known.includes(t));
    } catch {
      this.currentTags = [];
    }
    this.render();
  }

  private async save(): Promise<void> {
    if (!window.songName) {
      console.warn('tagEditor: window.songName missing, skipping save');
      return;
    }
    try {
      await saveSongTags({ songName: window.songName, tags: this.currentTags });
    } catch (err) {
      console.error('tagEditor: save failed', err);
    }
  }

  private render(): void {
    this.container.innerHTML = '';

    const label = document.createElement('span');
    label.className = 'tag-editor-label';
    label.textContent = 'Tags:';
    this.container.appendChild(label);

    const chipsWrap = document.createElement('span');
    chipsWrap.className = 'tag-chips';
    for (const tag of this.currentTags) {
      chipsWrap.appendChild(this.makeChip(tag));
    }
    this.container.appendChild(chipsWrap);

    const select = this.makeAddSelect();
    if (select) this.container.appendChild(select);
  }

  private makeChip(tag: string): HTMLSpanElement {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';

    const text = document.createElement('span');
    text.textContent = tag;

    const remove = document.createElement('button');
    remove.className = 'tag-chip-remove';
    remove.textContent = '×';
    remove.title = `Remove ${tag}`;
    remove.addEventListener('click', () => {
      this.currentTags = this.currentTags.filter((t) => t !== tag);
      void this.save();
      this.render();
    });

    chip.appendChild(text);
    chip.appendChild(remove);
    return chip;
  }

  private makeAddSelect(): HTMLSelectElement | null {
    const available = this.config.groups.flat().filter((t) => !this.currentTags.includes(t));
    if (available.length === 0) return null;

    const select = document.createElement('select');
    select.className = 'add-tag-select';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '+ Add tag';
    placeholder.disabled = true;
    placeholder.selected = true;
    select.appendChild(placeholder);

    for (const tag of available) {
      const opt = document.createElement('option');
      opt.value = tag;
      opt.textContent = tag;
      select.appendChild(opt);
    }

    select.addEventListener('change', () => {
      if (!select.value) return;
      this.currentTags = withTag(this.currentTags, select.value, this.config);
      void this.save();
      this.render();
    });

    return select;
  }
}

function mount(): void {
  const container = document.querySelector<HTMLElement>('.tag-editor');
  if (!container) return;
  void new TagEditor(container).init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
  mount();
}
