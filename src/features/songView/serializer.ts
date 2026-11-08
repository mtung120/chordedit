/**
 * Serializers — turn the rendered DOM back into the canonical on-disk
 * source text. Inverse of the parser: everything that lands in #raw-content
 * or goes out via /music/save-chords goes through here.
 *
 * Pure DOM reads — no state, no side effects.
 */

import { rawChord } from '../../utils/chords.js';

/** Serialize a .section-header element back to its "(Name{style})" source. */
export function serializeSectionHeader(el: HTMLElement): string {
  const headerName =
    el.querySelector<HTMLElement>('.section-header-name')?.textContent ?? '';
  const playStyle =
    el.querySelector<HTMLElement>('.section-header-playstyle')?.textContent ?? '';
  return '(' + (playStyle ? `${headerName}{${playStyle}}` : headerName) + ')';
}

/** Source text of one paragraph child (chord, play instruction, word, space…). */
function serializeInline(el: HTMLElement): string {
  if (el.classList?.contains('chord')) {
    // dataset.raw is the ASCII source; textContent is the prettified
    // display (♯/♭), which would round-trip to the wrong on-disk format.
    return '[' + (el.dataset.raw ?? rawChord(el.textContent)) + ']';
  }
  if (el.classList?.contains('play-instruction')) {
    return '[[' + (el.dataset.text ?? (el.textContent ?? '').trim()) + ']]';
  }
  return el.textContent ?? '';
}

/**
 * Serialize one .song-paragraph back to text: headers and `.song-line`
 * blocks each on their own line. Used by the inline paragraph editor to
 * pre-fill its textarea, and by getSongContent.
 */
export function serializeParagraph(paragraph: HTMLElement): string {
  const lines: string[] = [];
  paragraph.childNodes.forEach((node) => {
    const el = node as HTMLElement;
    if (el.classList?.contains('section-header')) {
      lines.push(serializeSectionHeader(el));
    } else if (el.classList?.contains('song-line')) {
      let text = '';
      el.childNodes.forEach((inner) => (text += serializeInline(inner as HTMLElement)));
      lines.push(text);
    }
  });
  return lines.join('\n');
}

/**
 * Serialize the entire song (the full #songView subtree) back to source.
 * This is what goes out over POST /music/save-chords and into #raw-content.
 * Paragraphs are separated by exactly one blank line (the .empty-line
 * spacers between them carry no text of their own).
 */
export function getSongContent(): string {
  const songView = document.getElementById('songView');
  if (!songView) return '';

  const paragraphs: string[] = [];
  songView.querySelectorAll<HTMLElement>(':scope > .song-paragraph').forEach((el) => {
    const text = serializeParagraph(el).replace(/\n+$/, '');
    if (text.trim()) paragraphs.push(text);
  });
  return paragraphs.join('\n\n');
}
