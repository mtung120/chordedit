/**
 * Pure music-theory utilities for chord text manipulation.
 *
 * Storage / transport / typing of chord names is always ASCII (`C#`, `Bb`,
 * `Am7b5`). The rendered text in chord chips uses real music symbols
 * `♯` (U+266F) and `♭` (U+266D) — crisper and more "sheet-music-like"
 * than ASCII `#` / `b`. Storage stays ASCII so transpose regex, search,
 * save-chords, and user typing all continue to work unchanged.
 */

/** ASCII → display: `C#` → `C♯`, `Bb` → `B♭`. Only call on actual chord names. */
export function prettifyChord(raw: unknown): string {
  return String(raw == null ? '' : raw).replace(/#/g, '♯').replace(/b/g, '♭');
}

/** Display → ASCII: inverse of prettifyChord. */
export function rawChord(display: unknown): string {
  return String(display == null ? '' : display).replace(/♯/g, '#').replace(/♭/g, 'b');
}

// ─── Keys and spelling ─────────────────────────────────────────────────────
// Keys are major keys by semitone (0 = C); a minor key is its relative major
// (Am → C). Notes are spelled from the key: sharp keys (G D A E B F#) use
// sharps, the rest flats, except F# in C (D/F#, F#m7b5).

/** Major key names by semitone, as the key menu shows them. */
export const KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const SHARP_KEYS = new Set([7, 2, 9, 4, 11, 6]);

const NOTE_TO_SEMITONE: Readonly<Record<string, number>> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};

/** The name of semitone `note` in `key`: spellNote(10, 5) → 'Bb'. */
export function spellNote(note: number, key: number): string {
  const n = ((note % 12) + 12) % 12;
  if (SHARP_KEYS.has(key)) return SHARP_NAMES[n]!;
  if (key === 0 && n === 6) return 'F#';
  return FLAT_NAMES[n]!;
}

/** Split "F#m7" into its root's semitone and the rest ("m7"). */
function splitRoot(part: string): { note: number; rest: string } | null {
  const m = /^([A-G][#b]?)(.*)$/.exec(part);
  const note = m ? NOTE_TO_SEMITONE[m[1]!] : undefined;
  return m && note !== undefined ? { note, rest: m[2]! } : null;
}

/**
 * Move a chord (no brackets) by `semitones`, spelling its root and bass
 * for `key`; the chord type ("m7b5", "sus4") is left as it is.
 *
 *   transposeChord('A#m7', 0, 5)   → 'Bbm7'
 *   transposeChord('G/B', 5, 0)    → 'C/E'
 *   transposeChord('D7/F#', 1, 3)  → 'Eb7/G'
 */
export function transposeChord(chord: string, semitones: number, key: number): string {
  return chord.split('/').map((part) => {
    const root = splitRoot(part);
    return root ? spellNote(root.note + semitones, key) + root.rest : part;
  }).join('/');
}

/** The major key a chord points to as a home chord, or null (V7, sus, dim…). */
function tonicKey(chord: string): number | null {
  const root = splitRoot(chord.split('/')[0] ?? '');
  if (!root || /^(sus|dim|aug|\+|o|7|9|11|13)/.test(root.rest)) return null;
  // A minor chord points to its relative major.
  return isMinor(root.rest) ? (root.note + 3) % 12 : root.note;
}

function isMinor(rest: string): boolean {
  return rest.startsWith('m') && !rest.startsWith('maj');
}

// Triad quality on each degree of a major key.
const DEGREE_QUALITY: Readonly<Record<number, 'maj' | 'min' | 'dim'>> = {
  0: 'maj', 2: 'min', 4: 'min', 5: 'maj', 7: 'maj', 9: 'min', 11: 'dim',
};

/** How many of the chords are among the key's seven. */
function keyFit(key: number, chords: string[]): number {
  let fit = 0;
  for (const chord of chords) {
    const root = splitRoot(chord.split('/')[0] ?? '');
    if (!root) continue;
    const quality = /^(dim|o|m7b5)/.test(root.rest) ? 'dim' : isMinor(root.rest) ? 'min' : 'maj';
    if (DEGREE_QUALITY[(root.note - key + 12) % 12] === quality) fit++;
  }
  return fit;
}

/**
 * Guess a song's major key from its chords: the key of its first home chord
 * and of its last chord (a final V7 points to its key: C7 → F). When they
 * differ, the one more of the chords belong to wins; a tie goes to the first.
 * Charts often stop on the V or after a key change, which this survives;
 * songs that start on IV and end away from home can come out wrong.
 */
export function detectKey(chords: string[]): number | null {
  const first = chords.map(tonicKey).find((k) => k !== null) ?? null;
  const lastChord = chords[chords.length - 1] ?? '';
  let last = tonicKey(lastChord);
  if (last === null) {
    const root = splitRoot(lastChord.split('/')[0] ?? '');
    if (root && /^(7|9|11|13)/.test(root.rest)) last = (root.note + 5) % 12;
  }
  if (first === null || last === null || first === last) return first ?? last;
  return keyFit(last, chords) > keyFit(first, chords) ? last : first;
}

/** Pull chord names from raw `[Chord]` bracket syntax. */
export function extractChordRoots(text: string | undefined | null): string[] {
  const out: string[] = [];
  const re = /\[([^\]]+)\]/g;
  let m: RegExpExecArray | null;
  const src = text ?? '';
  while ((m = re.exec(src)) !== null) {
    if (m[1] !== undefined) out.push(m[1]);
  }
  return out;
}

/**
 * Render a raw chord string as an array of DOM nodes, wrapping each
 * accidental (♯ / ♭) in a `<span class="chord-accidental">`.
 */
export function chordDisplayNodes(raw: unknown): Node[] {
  const nodes: Node[] = [];
  const src = String(raw == null ? '' : raw);
  let buf = '';
  const flush = (): void => {
    if (buf) {
      nodes.push(document.createTextNode(buf));
      buf = '';
    }
  };
  for (const ch of src) {
    if (ch === '#' || ch === 'b') {
      flush();
      const span = document.createElement('span');
      span.className = 'chord-accidental';
      span.textContent = ch === '#' ? '♯' : '♭';
      nodes.push(span);
    } else {
      buf += ch;
    }
  }
  flush();
  return nodes;
}
