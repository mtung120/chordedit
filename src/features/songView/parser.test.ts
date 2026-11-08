import { describe, expect, it } from 'vitest';
import { parseHeaderString } from './parser.js';

describe('parseHeaderString', () => {
  it('parses a plain name', () => {
    expect(parseHeaderString('Verse 1')).toEqual({ name: 'Verse 1', playStyle: '' });
  });

  it('parses a name with a play style', () => {
    expect(parseHeaderString('Chorus{Strum}')).toEqual({ name: 'Chorus', playStyle: 'Strum' });
  });

  it('parses a play-style-only header', () => {
    expect(parseHeaderString('{SOFT, NO DRUM}')).toEqual({ name: '', playStyle: 'SOFT, NO DRUM' });
  });

  it('ignores a legacy repeat-marker suffix', () => {
    expect(parseHeaderString('Chorus[rep-end,volta-1]')).toEqual({ name: 'Chorus', playStyle: '' });
    expect(parseHeaderString('Verse 2{PIANO}[rep-start]')).toEqual({ name: 'Verse 2', playStyle: 'PIANO' });
  });

  it('a marker-only legacy header parses empty', () => {
    expect(parseHeaderString('[rep-end,volta-1]')).toEqual({ name: '', playStyle: '' });
  });
});
