/**
 * Main song view — renders the song, owns chord / section / paragraph
 * editing, and drives auto-save.
 *
 * Two modes: 'view' (read-only) and 'edit' (every editing affordance live at
 * once: chord chips + word taps open the chord dialog, a section type picked
 * in the section palette and then a tapped paragraph set its header,
 * double-click (desktop) or long-press (touch) edits its raw text — play
 * styles and deleting a paragraph go through that text). The page mode
 * switcher (songMode.ts) drives setEditMode().
 *
 * Key: the song's key is detected from its chords on every render, plus the
 * song's saved correction (`window.songKeyOffset`, set in Edit's "Wrong key?
 * Set it" via relabelKey), and published as `key:change`. Moving to another key (the Display bar's
 * ♭ / ♯ and key menu) saves only in Edit; in Perform and Practice it changes
 * what's on screen, so each player's device can show its own key. Entering
 * Edit re-renders the stored song, dropping such a shift.
 */

import {
  chordDisplayNodes,
  detectKey,
  extractChordRoots,
  rawChord,
  transposeChord,
} from '../../utils/chords.js';
import { saveSongKey } from '../../api/client.js';
import { AutoSaver } from './autoSave.js';
import { parseHeaderString } from './parser.js';
import { mountSectionPalette } from './sectionPalette.js';
import {
  getSongContent as getSongContentDom,
  serializeParagraph as serializeParagraphDom,
} from './serializer.js';

// ─── Globals we need to read (templated/injected at page load) ───────────────

declare global {
  interface Window {
    /** Slug of the current song, set inline in song.html. */
    songName?: string;
    /** Published for songMode.ts and the Playwright specs. */
    songView?: SongViewPublic;
    /** song.html: semitones from the detected key to the real one (0–11). */
    songKeyOffset?: number;
  }
}

export type EditMode = 'view' | 'edit';

/** The surface other modules use (songMode, tests). */
export interface SongViewPublic {
  setEditMode(mode: EditMode): void;
  /** Move every chord to `key` (0 = C); saved only in Edit. */
  moveToKey(key: number): void;
  /** Edit only: the song is in `key`; the chords stay, the correction is saved. */
  relabelKey(key: number): void;
  /** Force-flush any pending debounced auto-save. */
  flushAutoSave(): Promise<void>;
  serializeParagraph(paragraph: HTMLElement): string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface DialogHandle {
  dialog: HTMLElement;
  backdrop: HTMLElement;
}

// ─── SongView class ──────────────────────────────────────────────────────────

class SongView {
  chordElements = new Set<HTMLElement>();
  private currentDialog: DialogHandle | null = null;
  private isInitialized = false;
  editMode: EditMode = 'view';
  /** Set by setupRawTextEditor; leaving edit mode discards an open raw edit. */
  private closeRawTextEditor: () => void = () => {};
  /** Major key of the chords on screen (0 = C), or null without chords. */
  private key: number | null = null;
  /** Chords on screen are in another key than the stored song. */
  private keyShifted = false;
  /** Semitones from the detected key to the song's real one (saved per song). */
  private keyOffset = window.songKeyOffset ?? 0;

  // Diatonic chords of C major / A minor, offered in the chord dialog.
  private readonly commonChords = ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bm7b5', 'G7'];
  private customChords: string[] = [];

  rawContent = '';

  /** Debounced, in-flight-guarded auto-saver. See ./autoSave.ts. */
  private readonly autoSaver = new AutoSaver({
    getContent: () => this.rawContent,
    onSaved: (content) => this.updateBaseContent(content),
    onIndicator: () => this.showSaveIndicator(),
  });

  constructor() {
    // Bind the methods that get used as event-listener callbacks so `this`
    // stays the SongView instance.
    this.handleElementClick = this.handleElementClick.bind(this);
    this.removeDialog = this.removeDialog.bind(this);
    this.handleDialogKeyDown = this.handleDialogKeyDown.bind(this);
    this.setEditMode = this.setEditMode.bind(this);
    this.moveToKey = this.moveToKey.bind(this);
    this.relabelKey = this.relabelKey.bind(this);
  }

  // ─── Public surface ───────────────────────────────────────────────────────

  addCustomChord(chord: string): void {
    if (this.commonChords.includes(chord) || this.customChords.includes(chord)) return;
    this.customChords.unshift(chord);
    if (this.customChords.length > 20) this.customChords = this.customChords.slice(0, 20);
  }

  /** Force-flush any pending debounced auto-save. */
  async flushAutoSave(): Promise<void> {
    await this.autoSaver.flush();
  }

  initialize(): void {
    try {
      if (this.isInitialized) return;
      const rawContentEl = document.getElementById('raw-content');
      if (!rawContentEl) throw new Error('Raw content element not found');
      const content = rawContentEl.textContent ?? '';
      this.rawContent = content;
      this.render(content);
      this.isInitialized = true;
      this.setupRawTextEditor();
      const palette = document.querySelector<HTMLElement>('.section-palette');
      if (palette) {
        mountSectionPalette(palette, (paragraph, type) => this.applySectionType(paragraph, type));
      }
    } catch (error) {
      console.error('Error initializing song view:', error);
    }
  }

  private setupRawTextEditor(): void {
    const openBtn = document.querySelector<HTMLButtonElement>('[data-action="editRawText"]');
    const editor = document.querySelector<HTMLElement>('.raw-text-editor');
    const textarea = document.querySelector<HTMLTextAreaElement>('.raw-text-area');
    const saveBtn = document.querySelector<HTMLButtonElement>('[data-action="rawTextSave"]');
    const cancelBtn = document.querySelector<HTMLButtonElement>('[data-action="rawTextCancel"]');
    if (!openBtn || !editor || !textarea || !saveBtn || !cancelBtn) return;

    const contentEl = document.querySelector<HTMLElement>('.content');

    const open = () => {
      textarea.value = this.rawContent;
      editor.hidden = false;
      if (contentEl) contentEl.hidden = true;
      openBtn.classList.add('active');
      textarea.focus();
    };

    const close = () => {
      editor.hidden = true;
      if (contentEl) contentEl.hidden = false;
      openBtn.classList.remove('active');
    };
    this.closeRawTextEditor = close;

    openBtn.addEventListener('click', () => {
      if (editor.hidden) {
        open();
      } else {
        close();
      }
    });

    saveBtn.addEventListener('click', () => {
      const newContent = textarea.value;
      this.rawContent = newContent;
      this.updateBaseContent(newContent);
      this.render(newContent);
      this.triggerAutoSave();
      close();
    });

    cancelBtn.addEventListener('click', () => close());
  }

  setEditMode(mode: EditMode): void {
    if (mode === this.editMode) return;
    this.editMode = mode;
    document.body.classList.toggle('mode-edit', mode === 'edit');
    // Edit saves what's on screen, so a key shift from Perform / Practice
    // must not reach it.
    if (mode === 'edit' && this.keyShifted) {
      const scrollY = window.scrollY;
      this.render(this.rawContent);
      window.scrollTo(0, scrollY);
    }
    // Re-render when leaving edit mode so paragraph spacing (CSS :has()
    // selectors based on .section-header presence) updates correctly.
    if (mode === 'view') {
      this.closeRawTextEditor();
      const scrollY = window.scrollY;
      this.render(this.rawContent);
      window.scrollTo(0, scrollY);
    }
  }

  // ─── Render pipeline ──────────────────────────────────────────────────────

  render(content: string): void {
    const contentDiv = document.querySelector<HTMLElement>('.content');
    if (!contentDiv) throw new Error('Content container not found');
    contentDiv.innerHTML = '';
    this.chordElements.clear();

    const songView = document.createElement('div');
    songView.id = 'songView';
    contentDiv.appendChild(songView);

    this.renderParagraphs(content, songView);
    this.keyShifted = false;
    this.setKey(this.songKey(content));
  }

  /** The key of `content`'s chords, corrected by the song's saved offset. */
  private songKey(content: string): number | null {
    const detected = detectKey(extractChordRoots(content));
    return detected === null ? null : (detected + this.keyOffset) % 12;
  }

  private setKey(key: number | null): void {
    this.key = key;
    document.dispatchEvent(new CustomEvent('key:change', { detail: { key } }));
  }

  private renderParagraphs(content: string, container: HTMLElement): void {
    const paragraphs = content.split(/\n\s*\n/);
    paragraphs.forEach((paragraphText, index) => {
      if (index > 0) {
        const emptyLine = document.createElement('div');
        emptyLine.className = 'empty-line';
        container.appendChild(emptyLine);
      }
      if (paragraphText.trim()) {
        const el = this.createParagraph(paragraphText);
        if (el) container.appendChild(el);
      }
    });
  }

  private createParagraph(text: string): HTMLElement | null {
    if (!text) return null;

    const paragraph = document.createElement('div');
    paragraph.className = 'song-paragraph';

    for (const el of this.parseContent(text)) {
      paragraph.appendChild(el);
    }

    // Desktop only: double-click opens inline text editor.
    if (!('ontouchstart' in window) && navigator.maxTouchPoints === 0) {
      paragraph.addEventListener('dblclick', (event) => {
        if (this.editMode !== 'edit') return;
        event.preventDefault();
        this.startInlineParagraphEdit(paragraph);
      });
    }

    this.addLongPressEdit(paragraph);

    return paragraph;
  }

  // ─── Mobile scroll lock ───────────────────────────────────────────────────

  private savedScrollY = 0;
  private scrollLocked = false;

  private lockScroll(): void {
    if (this.scrollLocked) return;
    this.scrollLocked = true;
    this.savedScrollY = window.scrollY;
    document.body.classList.add('scroll-locked');
    document.body.style.top = `-${this.savedScrollY}px`;
  }

  private unlockScroll(): void {
    if (!this.scrollLocked) return;
    this.scrollLocked = false;
    document.body.classList.remove('scroll-locked');
    document.body.style.top = '';
    window.scrollTo(0, this.savedScrollY);
  }

  // ─── Section headers (applied from the section palette) ──────────────────

  /**
   * Give a paragraph the header `type` (keeping its play style), then
   * renumber every Verse in song order. Other types carry no number.
   */
  private applySectionType(paragraph: HTMLElement, type: string): void {
    if (this.editMode !== 'edit') return;
    const existing = paragraph.querySelector<HTMLElement>('.section-header');
    if (existing) {
      const playStyle =
        existing.querySelector<HTMLElement>('.section-header-playstyle')?.textContent ?? '';
      this.fillSectionHeader(existing, type, playStyle);
    } else {
      paragraph.prepend(this.createSectionHeaderElement(type));
    }
    this.renumberVerses();
    this.commitChange();
  }

  private renumberVerses(): void {
    let n = 0;
    document.querySelectorAll<HTMLElement>('#songView .section-header-name').forEach((el) => {
      if (/^verse(\s+\d+)?$/i.test((el.textContent ?? '').trim())) el.textContent = `Verse ${++n}`;
    });
  }

  // ─── Parser (content → DOM elements) ──────────────────────────────────────

  /**
   * One paragraph's source → DOM: section headers as direct children, and
   * each lyric line as its own `.song-line` block (CSS hangs the wrapped
   * part of a long line, so it can't be mistaken for the next line).
   */
  private parseContent(text: string): Node[] {
    if (!text) return [];
    const elements: Node[] = [];
    const lines = text.split('\n');
    // Order matters: match [[...]] (play instruction) BEFORE [...] (chord).
    const tokenRegex = /\[\[([^\]]+)\]\]|\[([^\]]+)\]|\([^)]+\)|\s+|[^\s\[\]()]+/g;

    lines.forEach((line) => {
      // Line that contains ONLY a section header.
      const sectionHeaderMatch = line.match(/^\s*\(([^)]+)\)\s*$/);
      if (sectionHeaderMatch) {
        const { name, playStyle } = parseHeaderString(sectionHeaderMatch[1] ?? '');
        if (name || playStyle) elements.push(this.createSectionHeaderElement(name, playStyle));
        return;
      }

      let lineEl = this.createLineElement();
      const flushLine = (): void => {
        if (lineEl.hasChildNodes()) elements.push(lineEl);
        lineEl = this.createLineElement();
      };

      tokenRegex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = tokenRegex.exec(line)) !== null) {
        const token = match[0];
        if (token.startsWith('[[')) {
          lineEl.appendChild(this.createPlayInstructionElement(match[1] ?? ''));
        } else if (token.startsWith('[')) {
          lineEl.appendChild(this.createChordElement(match[2] ?? ''));
        } else if (token.startsWith('(') && token.endsWith(')')) {
          // Section header inline with other content: force onto its own line.
          // A legacy marker-only header like "([rep-end])" parses empty → dropped.
          const { name, playStyle } = parseHeaderString(token.slice(1, -1));
          if (name || playStyle) {
            flushLine();
            elements.push(this.createSectionHeaderElement(name, playStyle));
          }
        } else if (/^\s+$/.test(token)) {
          lineEl.appendChild(this.createSpaceElement(token));
        } else {
          lineEl.appendChild(this.createWordElement(token));
        }
      }
      flushLine();
    });

    return elements;
  }

  // ─── Element factories ────────────────────────────────────────────────────

  private createLineElement(): HTMLElement {
    const div = document.createElement('div');
    div.className = 'song-line';
    return div;
  }

  private createChordElement(chordText: string): HTMLElement {
    const span = document.createElement('span');
    span.className = 'chord clickable';
    // Normalize any Unicode ♯/♭ in the input back to ASCII before we
    // store as the canonical source — disk content from older saves
    // may contain prettified glyphs.
    const ascii = rawChord(chordText);
    span.dataset.raw = ascii;
    span.replaceChildren(...chordDisplayNodes(ascii));
    span.addEventListener('click', this.handleElementClick);
    this.chordElements.add(span);
    return span;
  }

  /**
   * Inline play-instruction element (e.g. "drum fills", "hold"). Storage
   * syntax is [[text]]; serialises back to that form via getSongContent.
   * Display-only — no click handler; user edits via the inline paragraph
   * editor. Not tracked in chordElements (transpose ignores it).
   */
  private createPlayInstructionElement(text: string): HTMLElement {
    const span = document.createElement('span');
    span.className = 'play-instruction';
    span.dataset.text = text;
    span.textContent = text;
    return span;
  }

  private createWordElement(word: string): HTMLElement {
    const span = document.createElement('span');
    span.textContent = word;
    span.className = 'clickable-word';
    span.addEventListener('click', this.handleElementClick);
    return span;
  }

  private createSpaceElement(space: string): HTMLElement {
    const span = document.createElement('span');
    span.textContent = space;
    span.className = 'clickable-space';
    span.addEventListener('click', this.handleElementClick);
    return span;
  }

  private createSectionHeaderElement(headerText: string, playStyle = ''): HTMLElement {
    const span = document.createElement('span');
    span.className = 'section-header';
    this.fillSectionHeader(span, headerText, playStyle);
    return span;
  }

  /** (Re)build a .section-header's name + optional play-style spans. */
  private fillSectionHeader(headerElement: HTMLElement, headerText: string, playStyle = ''): void {
    const name = document.createElement('span');
    name.className = 'section-header-name';
    name.textContent = headerText;
    name.style.fontWeight = 'bold';
    headerElement.replaceChildren(name);

    if (playStyle) {
      const ps = document.createElement('span');
      ps.className = 'section-header-playstyle';
      ps.textContent = playStyle;
      headerElement.appendChild(ps);
    }
  }

  // ─── Chord dialog ─────────────────────────────────────────────────────────

  private handleElementClick(event: Event): void {
    if (!event.target) return;
    if (this.editMode !== 'edit') return;
    this.showChordDialog(event.target as HTMLElement, event);
  }

  showChordDialog(element: HTMLElement, event: Event): void {
    if (!element || !event) return;
    event.preventDefault();
    event.stopPropagation();
    this.removeDialog();
    this.createChordDialog(element);
  }

  private createChordDialog(element: HTMLElement): void {
    const backdrop = document.createElement('div');
    backdrop.className = 'chord-dialog-backdrop';
    backdrop.addEventListener('click', this.removeDialog);
    document.body.appendChild(backdrop);

    const dialog = document.createElement('div');
    dialog.className = 'chord-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'chord-dialog-title');

    this.createDialogHeader(dialog, element);
    this.createChordOptions(dialog, element);
    this.createCustomChordSection(dialog, element);

    document.body.appendChild(dialog);

    // Touch: no auto-focus, so the keyboard doesn't cover the chords.
    const input = dialog.querySelector<HTMLInputElement>('.chord-custom-input');
    if (input && !window.matchMedia('(pointer: coarse)').matches) {
      setTimeout(() => input.focus(), 0);
    }

    // Desktop: let the second click of a double-click pass through to the
    // word underneath, so the paragraph's dblclick (inline text edit) fires.
    if (!('ontouchstart' in window) && navigator.maxTouchPoints === 0) {
      dialog.classList.add('click-through');
      backdrop.classList.add('click-through');
      setTimeout(() => {
        dialog.classList.remove('click-through');
        backdrop.classList.remove('click-through');
      }, 400);
    }

    document.addEventListener('keydown', this.handleDialogKeyDown);
    this.currentDialog = { dialog, backdrop };
  }

  private createDialogHeader(dialog: HTMLElement, element: HTMLElement): void {
    const isExistingChord = element.classList?.contains('chord');

    const header = document.createElement('div');
    header.className = 'chord-dialog-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'chord-dialog-title-wrap';

    const titleEl = document.createElement('h2');
    titleEl.className = 'chord-dialog-title';
    titleEl.id = 'chord-dialog-title';
    titleEl.textContent = isExistingChord ? 'Change chord' : 'Add chord';
    titleWrap.appendChild(titleEl);

    if (isExistingChord) {
      const current = document.createElement('span');
      current.className = 'chord-dialog-current';
      current.append(...chordDisplayNodes(element.dataset.raw ?? rawChord(element.textContent)));
      titleWrap.appendChild(current);
    }

    const close = document.createElement('button');
    close.className = 'chord-dialog-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    close.addEventListener('click', this.removeDialog);

    header.append(titleWrap, close);
    dialog.appendChild(header);

    // "Replace all" — only for existing chords; applies to a picked chord too,
    // so it sits above the choices.
    if (isExistingChord) {
      const label = document.createElement('label');
      label.className = 'chord-replace-all';
      const text = document.createElement('span');
      text.append('Change every ', ...chordDisplayNodes(element.dataset.raw ?? rawChord(element.textContent)), ' in the song');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.setAttribute('role', 'switch');
      label.append(text, cb);
      dialog.appendChild(label);
    }
  }

  private createChordOptions(dialog: HTMLElement, element: HTMLElement): void {
    const isExisting = element.classList.contains('chord');

    const pickChord = (chord: string): void => {
      const replaceAllCb = dialog.querySelector<HTMLInputElement>('input[type="checkbox"]');
      if (isExisting && replaceAllCb?.checked) {
        this.replaceAllChords(element, chord);
      } else {
        this.insertChord(element, chord);
      }
      this.removeDialog();
    };

    const addGroup = (label: string, chords: string[], custom: boolean): void => {
      const labelEl = document.createElement('div');
      labelEl.className = 'chord-section-label';
      labelEl.textContent = label;

      const section = document.createElement('div');
      section.className = custom ? 'chord-dialog-section custom-chords-section' : 'chord-dialog-section';
      for (const chord of chords) {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = custom ? 'chord-option custom-chord-option' : 'chord-option';
        option.append(...chordDisplayNodes(chord));
        option.addEventListener('click', () => pickChord(chord));
        section.appendChild(option);
      }
      dialog.append(labelEl, section);
    };

    if (this.customChords.length > 0) addGroup('Your chords', this.customChords, true);
    addGroup('Common chords', this.commonChords, false);
  }

  private createCustomChordSection(dialog: HTMLElement, element: HTMLElement): void {
    const isExisting = element.classList.contains('chord');
    const section = document.createElement('div');
    section.className = 'chord-dialog-custom';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'chord-custom-input';
    input.placeholder = 'Other chord';
    input.setAttribute('aria-label', 'Other chord');
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('autocorrect', 'off');

    const addButton = document.createElement('button');
    addButton.className = 'chord-custom-add';
    addButton.textContent = isExisting ? 'Change' : 'Add';
    addButton.type = 'button';
    addButton.disabled = true;

    const submit = (): void => {
      const customChord = input.value.trim();
      if (!customChord) return;
      this.addCustomChord(customChord);
      const replaceAllCb = dialog.querySelector<HTMLInputElement>('input[type="checkbox"]');
      if (isExisting && replaceAllCb?.checked) {
        this.replaceAllChords(element, customChord);
      } else {
        this.insertChord(element, customChord);
      }
      this.removeDialog();
    };
    input.addEventListener('input', () => { addButton.disabled = !input.value.trim(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    addButton.addEventListener('click', submit);

    section.append(input, addButton);

    if (isExisting) {
      const del = document.createElement('button');
      del.className = 'chord-delete-button';
      del.textContent = 'Delete chord';
      del.type = 'button';
      del.addEventListener('click', () => {
        this.deleteChord(element);
        this.removeDialog();
      });
      section.appendChild(del);
    }

    dialog.appendChild(section);
  }

  private handleDialogKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.removeDialog();
  }

  insertChord(element: HTMLElement, chordText: string): HTMLElement | undefined {
    if (!element || !chordText) return undefined;
    const ascii = rawChord(chordText);
    let chordElement: HTMLElement;

    if (element.classList.contains('chord')) {
      element.dataset.raw = ascii;
      element.replaceChildren(...chordDisplayNodes(ascii));
      chordElement = element;
    } else {
      chordElement = this.createChordElement(ascii);
      if (element.classList.contains('clickable-space')) {
        element.parentNode?.insertBefore(chordElement, element.nextSibling);
      } else {
        element.parentNode?.insertBefore(chordElement, element);
      }
    }

    this.addHighlightEffect(chordElement);
    this.commitChange();
    return chordElement;
  }

  private deleteChord(element: HTMLElement): void {
    if (!element.classList.contains('chord')) return;
    this.chordElements.delete(element);
    element.remove();
    this.commitChange();
  }

  /** Replace all occurrences of a chord with a new chord. */
  private replaceAllChords(element: HTMLElement, newChord: string): void {
    const oldRaw = element.dataset.raw ?? rawChord(element.textContent);
    const ascii = rawChord(newChord);
    let count = 0;
    this.chordElements.forEach((el) => {
      const elRaw = el.dataset.raw ?? rawChord(el.textContent);
      if (elRaw === oldRaw) {
        el.dataset.raw = ascii;
        el.replaceChildren(...chordDisplayNodes(ascii));
        this.addHighlightEffect(el);
        count++;
      }
    });
    this.commitChange();
  }

  private addHighlightEffect(element: HTMLElement | null): void {
    if (!element) return;
    // Force reflow for animation.
    void element.offsetWidth;
    element.classList.add('highlight');
    setTimeout(() => element.classList.remove('highlight'), 3000);
  }

  private removeDialog(): void {
    if (this.currentDialog) {
      this.currentDialog.dialog.remove();
      this.currentDialog.backdrop.remove();
      this.currentDialog = null;
      document.removeEventListener('keydown', this.handleDialogKeyDown);
    }
  }

  /** Move every chord to `key`, spelled for it; saved only in Edit. */
  moveToKey(key: number): void {
    if (this.key === null) return;
    const shift = key - this.key;
    this.chordElements.forEach((chordElement) => {
      const start = chordElement.dataset.raw ?? rawChord(chordElement.textContent);
      const next = transposeChord(start, shift, key);
      chordElement.dataset.raw = next;
      chordElement.replaceChildren(...chordDisplayNodes(next));
    });
    this.setKey(key);
    if (this.editMode === 'edit') this.commitChange();
    else this.keyShifted = true;
  }

  /** The song is in `key`: relabel without moving a chord and save the
   *  correction (Edit only). */
  relabelKey(key: number): void {
    if (this.key === null || this.editMode !== 'edit') return;
    this.keyOffset = (this.keyOffset + key - this.key + 12) % 12;
    this.setKey(key);
    const songName = window.songName;
    if (songName) {
      saveSongKey({ songName, keyOffset: this.keyOffset }).catch((err: unknown) => {
        console.error('Failed to save the key', err);
      });
    }
  }

  /** ♭ / ♯: one semitone down / up. */
  moveBySemitone(step: 1 | -1): void {
    if (this.key !== null) this.moveToKey((this.key + step + 12) % 12);
  }

  // ─── Content serialisation (delegates to ./serializer.ts) ────────────────

  getSongContent(): string {
    return getSongContentDom();
  }

  // ─── Auto-save (delegates to ./autoSave.ts) ───────────────────────────────

  private triggerAutoSave(): void {
    this.autoSaver.schedule();
  }

  private updateBaseContent(content: string): void {
    this.rawContent = content;
    const raw = document.getElementById('raw-content');
    if (raw) raw.textContent = content;
  }

  /** Refresh rawContent + #raw-content from the DOM and schedule an auto-save. */
  private commitChange(): void {
    const content = this.getSongContent();
    this.updateBaseContent(content);
    this.triggerAutoSave();
    // A song's first chords give it a key.
    if (this.key === null) this.setKey(this.songKey(content));
  }

  serializeParagraph(paragraph: HTMLElement): string {
    return serializeParagraphDom(paragraph);
  }

  // ─── Inline paragraph edit ────────────────────────────────────────────────

  /**
   * Attach long-press gesture to a paragraph for mobile inline editing.
   * Fires after 500ms of stationary touch; cancels on move or early lift.
   */
  private addLongPressEdit(paragraph: HTMLElement): void {
    const HOLD_MS = 500;
    const FEEDBACK_MS = 200;
    const MOVE_THRESHOLD = 10;

    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    let feedbackTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingEdit = false;
    let startX = 0;
    let startY = 0;

    const cancel = (): void => {
      if (holdTimer !== null) clearTimeout(holdTimer);
      if (feedbackTimer !== null) clearTimeout(feedbackTimer);
      holdTimer = null;
      feedbackTimer = null;
      pendingEdit = false;
      paragraph.classList.remove('long-press-active');
    };

    paragraph.addEventListener(
      'touchstart',
      (e) => {
        if (this.editMode !== 'edit') return;
        const te = e as TouchEvent;
        const touch = te.touches[0];
        if (!touch) return;
        startX = touch.clientX;
        startY = touch.clientY;

        feedbackTimer = setTimeout(() => {
          paragraph.classList.add('long-press-active');
        }, FEEDBACK_MS);

        holdTimer = setTimeout(() => {
          paragraph.classList.remove('long-press-active');
          // Don't call startInlineParagraphEdit here — inside setTimeout iOS
          // blocks focus() from showing the keyboard. Set a flag; touchend
          // (a real gesture event) triggers the editor so iOS grants
          // keyboard access.
          pendingEdit = true;
        }, HOLD_MS);
      },
      { passive: true },
    );

    paragraph.addEventListener(
      'touchmove',
      (e) => {
        const te = e as TouchEvent;
        const touch = te.touches[0];
        if (!touch) return;
        const dx = Math.abs(touch.clientX - startX);
        const dy = Math.abs(touch.clientY - startY);
        if (dx > MOVE_THRESHOLD || dy > MOVE_THRESHOLD) cancel();
      },
      { passive: true },
    );

    paragraph.addEventListener(
      'touchend',
      () => {
        const shouldEdit = pendingEdit;
        cancel();
        if (shouldEdit) this.startInlineParagraphEdit(paragraph);
      },
      { passive: true },
    );

    paragraph.addEventListener('touchcancel', cancel, { passive: true });
    // Suppress iOS native long-press context menu
    paragraph.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /**
   * Overlay an inline textarea directly on top of a paragraph without
   * removing it from the DOM, so the multicolumn layout never reflows.
   */
  startInlineParagraphEdit(paragraph: HTMLElement): void {
    this.removeDialog();
    window.getSelection()?.removeAllRanges();

    const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const rawText = this.serializeParagraph(paragraph);
    const rect = paragraph.getBoundingClientRect();

    const textarea = document.createElement('textarea');
    textarea.className = 'inline-para-editor';
    textarea.value = rawText;

    textarea.style.position = 'fixed';
    textarea.style.top = `${rect.top}px`;
    textarea.style.left = `${rect.left}px`;
    textarea.style.width = `${rect.width}px`;
    textarea.style.minHeight = `${rect.height}px`;
    textarea.style.zIndex = '500';
    textarea.style.boxSizing = 'border-box';

    paragraph.style.visibility = 'hidden';

    document.body.appendChild(textarea);

    let overlay: HTMLDivElement | null = null;
    let onBlur: (() => void) | null = null;
    let onScroll: (() => void) | null = null;

    const autoGrow = (): void => {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    };
    textarea.addEventListener('input', autoGrow);
    requestAnimationFrame(autoGrow);
    if (isMobile) this.lockScroll();
    textarea.focus();

    let finished = false;
    const finish = (save: boolean): void => {
      if (finished) return;
      finished = true;
      textarea.removeEventListener('keydown', onKeyDown);
      if (isMobile) {
        this.unlockScroll();
        overlay?.remove();
      } else {
        if (onScroll) window.removeEventListener('scroll', onScroll, true);
      }
      if (onBlur) textarea.removeEventListener('blur', onBlur);
      textarea.remove();
      paragraph.style.visibility = '';

      if (save && textarea.value !== rawText) {
        const text = textarea.value;
        paragraph.querySelectorAll<HTMLElement>('.chord').forEach((el) =>
          this.chordElements.delete(el),
        );
        const subTexts = text.split(/\n[ \t]*\n/);
        if (!text.trim()) {
          // Emptied — delete the paragraph and one of its spacers.
          const next = paragraph.nextElementSibling;
          const prev = paragraph.previousElementSibling;
          if (next?.classList.contains('empty-line')) next.remove();
          else if (prev?.classList.contains('empty-line')) prev.remove();
          paragraph.remove();
        } else if (subTexts.length > 1) {
          // User added a blank line — split into separate paragraphs.
          const fragment = document.createDocumentFragment();
          subTexts.forEach((paraText, idx) => {
            if (idx > 0) {
              const emptyLine = document.createElement('div');
              emptyLine.className = 'empty-line';
              fragment.appendChild(emptyLine);
            }
            if (paraText.trim()) {
              const para = this.createParagraph(paraText);
              if (para) fragment.appendChild(para);
            }
          });
          paragraph.replaceWith(fragment);
        } else {
          const replacement = this.createParagraph(text);
          if (replacement) paragraph.replaceWith(replacement);
        }
        this.commitChange();
      }
    };

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        finish(true);
      }
    };
    textarea.addEventListener('keydown', onKeyDown);

    if (isMobile) {
      // On mobile, tapping outside or pressing "Done" on the keyboard
      // triggers blur, which saves. No green confirm button needed.
      overlay = document.createElement('div');
      overlay.className = 'inline-edit-overlay';
      overlay.addEventListener('click', () => finish(true));
      document.body.appendChild(overlay);

      onBlur = () => finish(true);
      textarea.addEventListener('blur', onBlur);
    } else {
      onBlur = () => finish(true);
      let scrollGuard = true;
      requestAnimationFrame(() => {
        scrollGuard = false;
      });
      onScroll = () => {
        if (scrollGuard) return;
        finish(true);
      };
      textarea.addEventListener('blur', onBlur);
      window.addEventListener('scroll', onScroll, true);
    }
  }

  // ─── Notifications ────────────────────────────────────────────────────────

  private showSaveIndicator(): void {
    this.showNotification('✓ Saved', '#28a745');
  }

  private showNotification(message: string, backgroundColor = '#28a745'): void {
    document.querySelector<HTMLElement>('.save-indicator')?.remove();

    const indicator = document.createElement('div');
    indicator.className = 'save-indicator';
    indicator.textContent = message;
    indicator.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${backgroundColor};
      color: white;
      padding: 8px 16px;
      border-radius: 4px;
      font-size: 14px;
      z-index: 1000;
      opacity: 0;
      transition: opacity 0.3s ease;
    `;
    document.body.appendChild(indicator);

    setTimeout(() => {
      indicator.style.opacity = '1';
    }, 10);
    setTimeout(() => {
      indicator.style.opacity = '0';
      setTimeout(() => indicator.parentNode?.removeChild(indicator), 300);
    }, 2000);
  }
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

function wireTransposeDelegation(instance: SongView): void {
  document.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (action === 'transposeUp' || action === 'transposeDown') {
      e.preventDefault();
      instance.moveBySemitone(action === 'transposeUp' ? 1 : -1);
    }
  });
}

function mount(): void {
  const contentDiv = document.querySelector('.content');
  if (!contentDiv) return;
  const instance = new SongView();
  window.songView = instance;
  wireTransposeDelegation(instance);
  instance.initialize();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
  mount();
}

export { SongView };
