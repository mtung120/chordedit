/**
 * Section palette — the Edit-mode bar of section types (top of the lyrics
 * on desktop, bottom of the screen on touch screens, in thumb reach).
 * Tap a chip to pick it, then tap a paragraph to give it that header.
 *
 * Tap-tap instead of drag-and-drop: on a phone, dragging made one finger
 * hold, move and scroll the page at once, and often didn't stick. A picked
 * chip turns dark and the paragraphs get an outline; while it's picked, a
 * tap anywhere in a paragraph (a word included) sets the header instead
 * of opening the chord dialog. One header per pick. Tapping the chip
 * again, Escape, a tap outside the lyrics, or PICK_TIMEOUT_MS with no
 * activity (scrolling to the section counts as activity) drops the pick.
 */

export const SECTION_TYPES = [
  'Intro',
  'Verse',
  'Pre-Chorus',
  'Chorus',
  'Bridge',
  'Solo',
  'Rap',
  'Outro',
] as const;

/** Shorter chip text, so the equal-width chips stay narrow. */
const CHIP_LABELS: Partial<Record<(typeof SECTION_TYPES)[number], string>> = {
  'Pre-Chorus': 'Pre',
};

export const PICK_TIMEOUT_MS = 3000;

export function mountSectionPalette(
  bar: HTMLElement,
  onApply: (paragraph: HTMLElement, type: string) => void,
): void {
  const row = document.createElement('div');
  row.className = 'section-chips';
  bar.appendChild(row);

  let picked: { chip: HTMLElement; type: string } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const restartTimer = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(drop, PICK_TIMEOUT_MS);
    // Restart the chip's countdown bar too.
    if (picked) {
      picked.chip.classList.remove('picked');
      void picked.chip.offsetWidth;
      picked.chip.classList.add('picked');
    }
  };

  function drop(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!picked) return;
    picked.chip.classList.remove('picked');
    picked.chip.setAttribute('aria-pressed', 'false');
    picked = null;
    document.body.classList.remove('section-picking');
    document.removeEventListener('click', onDocClick, true);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('scroll', restartTimer);
  }

  const pick = (chip: HTMLElement, type: string): void => {
    picked = { chip, type };
    chip.setAttribute('aria-pressed', 'true');
    document.body.classList.add('section-picking');
    // Capture phase: runs before the word / chord click handlers.
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', restartTimer, { passive: true });
    restartTimer();
  };

  function onDocClick(e: MouseEvent): void {
    if (!picked) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('.section-palette')) return; // the chips handle it
    const paragraph = target?.closest<HTMLElement>('#songView .song-paragraph');
    if (!paragraph) {
      drop();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const { type } = picked;
    drop();
    onApply(paragraph, type);
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') drop();
  }

  for (const type of SECTION_TYPES) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'section-chip';
    chip.textContent = CHIP_LABELS[type] ?? type;
    chip.title = `Tap, then tap a section: ${type}`;
    chip.setAttribute('aria-pressed', 'false');
    chip.addEventListener('click', () => {
      const same = picked?.chip === chip;
      drop();
      if (!same) pick(chip, type);
    });
    row.appendChild(chip);
  }

  // Leaving Edit (or opening Raw text) mid-pick must not leave it armed.
  document.addEventListener('songmode:change', drop);
}
