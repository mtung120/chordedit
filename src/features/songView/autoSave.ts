/**
 * Auto-saver for song edits.
 *
 * Behavior (locked in by tests/specs/autoSave.spec.ts):
 *   - Debounced: one save fires 1s after the last edit.
 *   - In-flight guarded: at most one POST in flight at any time.
 *   - Coalescing: edits arriving during a save produce exactly one
 *     follow-up save (not a queue of N).
 *
 * The caller provides getContent() + onSaved(content) callbacks so the
 * saver stays decoupled from DOM / state mutation.
 */

import { saveChords as apiSaveChords } from '../../api/client.js';

export interface AutoSaverOptions {
  /** Debounce delay in milliseconds (default 1000). */
  delayMs?: number;
  /** Called to read the latest serialised song content. */
  getContent: () => string;
  /** Called after a successful save. Typically refreshes raw-content / lyrics. */
  onSaved: (content: string) => void;
  /** Called on save success so the UI can flash a "✓ Saved" indicator. */
  onIndicator?: () => void;
}

export class AutoSaver {
  private readonly delayMs: number;
  private readonly getContent: () => string;
  private readonly onSaved: (content: string) => void;
  private readonly onIndicator: (() => void) | undefined;

  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private pending = false;

  constructor(opts: AutoSaverOptions) {
    this.delayMs = opts.delayMs ?? 1000;
    this.getContent = opts.getContent;
    this.onSaved = opts.onSaved;
    this.onIndicator = opts.onIndicator;
  }

  /** Debounced save request. Call on every edit. */
  schedule(): void {
    if (this.timeoutId !== null) clearTimeout(this.timeoutId);
    this.timeoutId = setTimeout(() => void this.flush(), this.delayMs);
  }

  /** Run a save immediately (bypasses debounce). Respects in-flight guard. */
  async flush(): Promise<void> {
    if (this.inFlight) {
      this.pending = true;
      return;
    }

    const content = this.getContent();
    if (!content) return;

    const slug = window.songName;
    if (!slug) {
      console.warn('autoSave: window.songName missing; skipping POST');
      return;
    }

    this.inFlight = true;
    try {
      const version = window.songVersion ?? 0;
      await apiSaveChords({ songName: slug, content, version: version || undefined });
      console.log('Auto-saved successfully');
      this.onIndicator?.();
      this.onSaved(content);
    } catch (err) {
      console.error('Auto-save error:', err);
    } finally {
      this.inFlight = false;
      if (this.pending) {
        this.pending = false;
        void this.flush();
      }
    }
  }
}

declare global {
  interface Window {
    songName?: string;
    songVersion?: number;
  }
}
