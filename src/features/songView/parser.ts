/**
 * Header-string parser — extracts name / play-style from the text inside a
 * section header's parens.
 *
 * Pure string work, no DOM. parseContent (text → DOM-element list) lives in
 * songView.ts because it depends on SongView's element factories.
 */

export interface ParsedHeader {
  name: string;
  playStyle: string;
}

/**
 * Parse a raw header string (what lives inside "(...)") into its components.
 * Supports "Name" and "Name{Style}". A trailing "[…]" suffix — the removed
 * repeat-marker syntax, e.g. "Chorus[rep-end,volta-1]" — is ignored, so
 * legacy files render (and re-save) without it.
 */
export function parseHeaderString(headerText: string): ParsedHeader {
  const text = headerText.replace(/\[[^\]]*\]\s*$/, '');
  const withStyle = text.match(/^(.*?)\{([^}]+)\}$/);
  if (withStyle) return { name: withStyle[1] ?? '', playStyle: withStyle[2] ?? '' };
  return { name: text, playStyle: '' };
}
