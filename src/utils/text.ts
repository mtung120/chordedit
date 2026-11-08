/**
 * Title helpers shared by the home page's search and its add-song flow.
 */

/** Strip Vietnamese diacritics so "con mua" matches "Cơn Mưa Băng Giá". */
export function foldDiacritics(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, (m) => (m === 'đ' ? 'd' : 'D'));
}

/**
 * Comparison key for "same title": no case, accents or extra spaces;
 * hyphens and underscores count as spaces (a song without a title shows
 * its slug, e.g. "simple-ballad").
 */
export function titleKey(title: string): string {
  return foldDiacritics(title).toLowerCase().replace(/[\s_-]+/g, ' ').trim();
}

/** Keep in sync with songTitleMax in handlers/render.go. */
export const SONG_TITLE_MAX = 25;

/** The song page's heading: the title capped at SONG_TITLE_MAX characters. */
export function shortTitle(title: string): string {
  const chars = Array.from(title);
  if (chars.length <= SONG_TITLE_MAX) return title;
  return `${chars.slice(0, SONG_TITLE_MAX).join('').trimEnd()}…`;
}

/**
 * A song slug (file name) from a title: ASCII letters, digits, spaces and
 * hyphens ("Đêm Đông" → "Dem Dong"). Matches what the server's
 * sanitizeSongName leaves unchanged.
 */
export function slugFromTitle(title: string): string {
  return foldDiacritics(title)
    .replace(/[^a-zA-Z0-9 -]/g, '')
    .replace(/ +/g, ' ')
    .replace(/-+/g, '-')
    .trim()
    .replace(/^-+|-+$/g, '');
}
