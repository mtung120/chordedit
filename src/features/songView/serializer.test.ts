import { beforeEach, describe, expect, it } from 'vitest';
import { getSongContent } from './serializer.js';

/** The DOM songView renders: paragraphs separated by .empty-line spacers,
 *  each a header (optional) plus one .song-line block per lyric line. */
function render(html: string): void {
  document.body.innerHTML = `<div id="songView">${html}</div>`;
}

const header = (name: string, style = '') =>
  `<span class="section-header"><span class="section-header-name">${name}</span>` +
  (style ? `<span class="section-header-playstyle">${style}</span>` : '') +
  '</span>';
const chord = (raw: string) => `<span class="chord" data-raw="${raw}">${raw}</span>`;
const word = (w: string) => `<span class="clickable-word">${w}</span>`;
const space = '<span class="clickable-space"> </span>';
const gap = '<div class="empty-line"></div>';
const para = (inner: string) => `<div class="song-paragraph">${inner}</div>`;
const line = (inner: string) => `<div class="song-line">${inner}</div>`;

describe('getSongContent', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('separates paragraphs with exactly one blank line', () => {
    render(
      para(`${header('Intro')}${line(`${chord('C')}${space}${chord('G')}`)}`) +
        gap +
        para(`${header('Verse 1')}${line(`${chord('C')}${word('Hello')}`)}${line(`${chord('Am')}${word('Two')}`)}`) +
        gap +
        para(line(`${chord('F')}${word('Bare')}`)),
    );
    expect(getSongContent()).toBe(
      '(Intro)\n[C] [G]\n\n(Verse 1)\n[C]Hello\n[Am]Two\n\n[F]Bare',
    );
  });

  it('writes a header and the lyric after it on separate lines', () => {
    // An inline "(Verse 1{Soft})Lyric" source renders as header + line.
    render(para(`${header('Verse 1', 'Soft')}${line(word('Lyric'))}`) + gap + para(line(word('Next'))));
    expect(getSongContent()).toBe('(Verse 1{Soft})\nLyric\n\nNext');
  });

  it('skips spacers left by leading / repeated blank lines', () => {
    render(gap + gap + para(line(word('One'))) + gap + gap + para(line(word('Two'))) + gap);
    expect(getSongContent()).toBe('One\n\nTwo');
  });
});
