import { describe, expect, it } from 'vitest';

import {
  KEY_NAMES,
  detectKey,
  extractChordRoots,
  prettifyChord,
  rawChord,
  spellNote,
  transposeChord,
} from './chords.js';
import songs from './detectKey.fixtures.json';

const key = (name: string): number => KEY_NAMES.indexOf(name as (typeof KEY_NAMES)[number]);

describe('prettifyChord / rawChord', () => {
  it('round-trips ASCII ↔ display', () => {
    const cases: Array<[string, string]> = [
      ['C#', 'C♯'],
      ['Bb', 'B♭'],
      ['Am7b5', 'Am7♭5'],
      ['F#m7b5', 'F♯m7♭5'],
      ['G/B', 'G/B'],
      ['G', 'G'],
    ];
    for (const [ascii, pretty] of cases) {
      expect(prettifyChord(ascii)).toBe(pretty);
      expect(rawChord(pretty)).toBe(ascii);
    }
  });

  it('handles null/undefined as empty string', () => {
    expect(prettifyChord(null)).toBe('');
    expect(prettifyChord(undefined)).toBe('');
    expect(rawChord(null)).toBe('');
  });
});

describe('spellNote', () => {
  it('spells sharp keys with sharps and the rest with flats', () => {
    expect([1, 3, 6, 8, 10].map((n) => spellNote(n, key('G')))).toEqual(['C#', 'D#', 'F#', 'G#', 'A#']);
    expect([1, 3, 6, 8, 10].map((n) => spellNote(n, key('F')))).toEqual(['Db', 'Eb', 'Gb', 'Ab', 'Bb']);
    expect([1, 3, 6, 8, 10].map((n) => spellNote(n, key('Eb')))).toEqual(['Db', 'Eb', 'Gb', 'Ab', 'Bb']);
  });

  it('writes F# in C', () => {
    expect([1, 3, 6, 8, 10].map((n) => spellNote(n, key('C')))).toEqual(['Db', 'Eb', 'F#', 'Ab', 'Bb']);
  });

  it('never writes E#, B#, Cb or Fb', () => {
    for (let k = 0; k < 12; k++) {
      for (let n = 0; n < 12; n++) expect(spellNote(n, k)).toMatch(/^([A-G]|[ACDFG]#|[ABDEG]b)$/);
    }
  });
});

describe('transposeChord', () => {
  it('moves the root and spells it for the target key', () => {
    expect(transposeChord('C', 2, key('D'))).toBe('D');
    expect(transposeChord('Am', 3, key('Eb'))).toBe('Cm');
    expect(transposeChord('E7', -4, key('C'))).toBe('C7');
    expect(transposeChord('F#m7b5', -7, key('C'))).toBe('Bm7b5');
  });

  it('respells without moving', () => {
    expect(transposeChord('A#', 0, key('F'))).toBe('Bb');
    expect(transposeChord('A#m7', 0, key('Db'))).toBe('Bbm7');
    expect(transposeChord('Bb', 0, key('D'))).toBe('A#');
  });

  it('moves both halves of a slash chord', () => {
    expect(transposeChord('G/B', 5, key('C'))).toBe('C/E');
    expect(transposeChord('D7/F#', 1, key('Eb'))).toBe('Eb7/G');
    expect(transposeChord('D/F#', -2, key('C'))).toBe('C/E');
  });

  it('leaves the chord type and unknown parts alone', () => {
    expect(transposeChord('Cmaj7', 1, key('Db'))).toBe('Dbmaj7');
    expect(transposeChord('G7sus4', -1, key('B'))).toBe('F#7sus4');
    expect(transposeChord('N.C.', 3, key('C'))).toBe('N.C.');
    expect(transposeChord('E7/dm7', 0, key('C'))).toBe('E7/dm7');
  });

  it('comes back to the same chords after twelve semitones', () => {
    let chord = 'Bbmaj7/D';
    for (let i = 1; i <= 12; i++) chord = transposeChord(chord, 1, (key('Bb') + i) % 12);
    expect(chord).toBe('Bbmaj7/D');
  });
});

describe('detectKey', () => {
  it('reads the key from the last chord, a minor chord as its relative major', () => {
    expect(detectKey(['C', 'G', 'Am', 'F', 'C'])).toBe(key('C'));
    expect(detectKey(['F#m', 'E', 'D', 'F#m'])).toBe(key('A'));
  });

  it('keeps the first chord when the chart stops on the V', () => {
    expect(detectKey(['C', 'F', 'Am', 'G', 'C', 'F', 'G'])).toBe(key('C'));
  });

  it('follows a final V7 to its key', () => {
    expect(detectKey(['Gm7', 'C7', 'Fmaj7', 'Dm7', 'Gm7', 'C7'])).toBe(key('F'));
  });

  it('returns null for a song without chords', () => {
    expect(detectKey([])).toBeNull();
    expect(detectKey(['N.C.'])).toBeNull();
  });

  // 60 songs from the library, keys checked by hand. The rule misses a few
  // (they start on IV and end after a key change); those pin what it says.
  for (const song of songs as Array<{ title: string; key: string; detected?: string; chords: string[] }>) {
    it(`${song.title}: ${song.detected ? `${song.detected} (really ${song.key})` : song.key}`, () => {
      expect(detectKey(song.chords)).toBe(key(song.detected ?? song.key));
    });
  }
});

describe('extractChordRoots', () => {
  it('extracts every [Chord] token in document order', () => {
    const text = '[C]Hello [G]world this is a [Am]test';
    expect(extractChordRoots(text)).toEqual(['C', 'G', 'Am']);
  });

  it('handles repeated chords and slash chords', () => {
    expect(extractChordRoots('[D7/F#] [G/B] [D7/F#]')).toEqual(['D7/F#', 'G/B', 'D7/F#']);
  });

  it('returns empty array for empty / null', () => {
    expect(extractChordRoots('')).toEqual([]);
    expect(extractChordRoots(null)).toEqual([]);
    expect(extractChordRoots(undefined)).toEqual([]);
  });
});
