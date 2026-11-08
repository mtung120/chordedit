/**
 * HTML-escape a value for safe interpolation into innerHTML / template strings.
 *
 * Replaces &, <, >, ", and ' with their entity equivalents. Use this any time
 * you build markup from a string that originated outside your control —
 * server response, user input, URL query, etc.
 */
export function escapeHTML(value: unknown): string {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
