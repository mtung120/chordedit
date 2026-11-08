/**
 * The Practice panel's metronome sheet (bottom sheet on phones, a dialog
 * elsewhere). A view only: VideoPlayerWidget owns the metronome's state and
 * timing, hands it in as a MetronomeView, and gets the user's actions back.
 *
 * Two layouts, picked when the sheet opens:
 * - setup (no tempo yet, or "Tap again"): three steps and a big tap pad —
 *   a tap while the song is paused plays it, then each tap marks a beat;
 * - tuned: BPM − / +, a 10 ms nudge for clicks that sit early or late, and
 *   "Tap again".
 * Both show play / pause, the song time, beat dots that follow the clicks,
 * and Beats per bar.
 */

export const TIME_SIGS = ['2/4', '3/4', '4/4', '5/4', '6/8', '12/8'] as const;

export interface MetronomeView {
  /** Tempo, beat 1 and time signature are all known: clicks can play. */
  ready: boolean;
  enabled: boolean;
  bpm: number | null;
  timeSig: string;
  offsetMs: number;
  playing: boolean;
  /** "1:24" */
  time: string;
  /** Taps in the current run (setup). */
  taps: number;
}

export interface MetronomeActions {
  toggle(): void;
  tap(): void;
  playPause(): void;
  bpmBy(delta: number): void;
  nudge(ms: number): void;
  setTimeSig(sig: string): void;
  /** Start a fresh tap run (setup layout). */
  retap(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function button(className: string, text: string, onClick: () => void, label?: string): HTMLButtonElement {
  const btn = el('button', className, text);
  btn.type = 'button';
  if (label) btn.setAttribute('aria-label', label);
  btn.addEventListener('click', onClick);
  return btn;
}

const CHEVRON = (dir: 'left' | 'right'): string =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${dir === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'}"/></svg>`;
const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" fill="currentColor"/></svg>';
const PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor"/></svg>';

export class MetronomeSheet {
  private readonly overlay: HTMLDivElement;
  private readonly sheet: HTMLDivElement;
  private readonly title: HTMLHeadingElement;
  private readonly switchBtn: HTMLButtonElement;
  private readonly setupEl: HTMLDivElement;
  private readonly tunedEl: HTMLDivElement;
  private readonly steps: HTMLLIElement[] = [];
  private readonly pad: HTMLButtonElement;
  private readonly padBig: HTMLSpanElement;
  private readonly padSub: HTMLSpanElement;
  private readonly bpmEl: HTMLSpanElement;
  private readonly offsetEl: HTMLSpanElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly timeEl: HTMLSpanElement;
  private readonly beatsEl: HTMLSpanElement;
  private readonly sigBtns: HTMLButtonElement[] = [];
  private readonly liveRow: HTMLElement;
  private readonly sigRow: HTMLElement;
  private readonly retapRow: HTMLElement;
  private mode: 'setup' | 'tuned' = 'setup';
  private opener: HTMLElement | null = null;
  private beatCount = 0;
  private beat: number | null = null;

  constructor(actions: MetronomeActions) {
    this.overlay = el('div', 'metro-overlay');
    this.overlay.hidden = true;
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });

    this.sheet = el('div', 'metro-sheet');
    this.sheet.setAttribute('role', 'dialog');
    this.sheet.setAttribute('aria-modal', 'true');
    this.sheet.setAttribute('aria-labelledby', 'metro-title');
    this.sheet.tabIndex = -1;

    // Head: title · switch · Done
    const head = el('div', 'metro-head');
    this.title = el('h2', 'metro-title');
    this.title.id = 'metro-title';
    this.switchBtn = button('metro-switch', '', () => actions.toggle(), 'Clicks while the song plays');
    this.switchBtn.setAttribute('role', 'switch');
    this.switchBtn.innerHTML = '<span class="vp-switch" aria-hidden="true"></span>';
    const done = button('metro-done', 'Done', () => this.close());
    head.append(this.title, this.switchBtn, el('span', 'metro-spacer'), done);

    // Setup: steps + tap pad
    this.setupEl = el('div', 'metro-setup');
    const ol = el('ol', 'metro-steps');
    for (const [i, text] of ['Play the song', 'Tap the pad on every beat, a few bars', 'End on a “1”: your last tap becomes beat 1'].entries()) {
      const li = el('li', 'metro-step');
      li.append(el('span', 'metro-step-num', String(i + 1)), el('span', 'metro-step-text', text));
      ol.append(li);
      this.steps.push(li);
    }
    this.pad = button('metro-pad', '', () => actions.tap());
    this.padBig = el('span', 'metro-pad-big');
    this.padSub = el('span', 'metro-pad-sub');
    this.pad.append(this.padBig, this.padSub);
    this.setupEl.append(ol, this.pad);

    // Tuned: BPM − / + and the nudge
    this.tunedEl = el('div', 'metro-tuned');
    const bpmRow = el('div', 'metro-bpm-row');
    const bpmBox = el('div', 'metro-bpm');
    this.bpmEl = el('span', 'metro-bpm-value');
    bpmBox.append(this.bpmEl, el('span', 'metro-label', 'BPM'));
    bpmRow.append(
      button('metro-round', '−', () => actions.bpmBy(-1), 'Slower by 1 BPM'),
      bpmBox,
      button('metro-round', '+', () => actions.bpmBy(1), 'Faster by 1 BPM'),
    );
    const nudge = el('div', 'metro-nudge');
    const earlier = button('metro-icon-btn', '', () => actions.nudge(-10), 'Clicks 10 ms earlier');
    earlier.innerHTML = CHEVRON('left');
    const later = button('metro-icon-btn', '', () => actions.nudge(10), 'Clicks 10 ms later');
    later.innerHTML = CHEVRON('right');
    this.offsetEl = el('span', 'metro-offset');
    this.offsetEl.setAttribute('aria-live', 'polite');
    nudge.append(el('span', 'metro-nudge-text', 'Clicks early or late?'), earlier, this.offsetEl, later);
    this.tunedEl.append(bpmRow, nudge);

    // Both: play / pause · time · beat dots
    const live = el('div', 'metro-live');
    this.playBtn = button('metro-play', '', () => actions.playPause());
    this.timeEl = el('span', 'metro-time');
    this.beatsEl = el('span', 'metro-beats');
    this.beatsEl.setAttribute('aria-hidden', 'true');
    live.append(this.playBtn, this.timeEl, el('span', 'metro-spacer'), this.beatsEl);

    // Both: beats per bar
    const sig = el('div', 'metro-sig');
    const seg = el('div', 'vp-seg metro-sig-seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Beats per bar');
    for (const s of TIME_SIGS) {
      const btn = button('vp-btn', s, () => actions.setTimeSig(s));
      this.sigBtns.push(btn);
      seg.append(btn);
    }
    sig.append(el('span', 'metro-label', 'Beats per bar'), seg);

    // Tuned: re-sync
    const retap = el('div', 'metro-retap');
    retap.append(
      el('span', 'metro-retap-text', 'Off the beat? Tap along again to re-sync.'),
      button('metro-outline', 'Tap again', () => {
        this.mode = 'setup';
        actions.retap();
      }),
    );
    // The live row and Beats per bar are shared: update() moves them.
    this.liveRow = live;
    this.sigRow = sig;
    this.retapRow = retap;

    this.sheet.append(el('div', 'metro-grabber'), head, this.setupEl, this.tunedEl);
    this.overlay.append(this.sheet);
    document.body.append(this.overlay);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen()) this.close();
    });
  }

  isOpen(): boolean {
    return !this.overlay.hidden;
  }

  open(view: MetronomeView, opener: HTMLElement): void {
    this.opener = opener;
    this.mode = view.ready ? 'tuned' : 'setup';
    this.overlay.hidden = false;
    this.update(view);
    this.sheet.focus();
  }

  close(): void {
    if (!this.isOpen()) return;
    this.overlay.hidden = true;
    this.opener?.focus();
  }

  /** Re-draw from the widget's state. */
  update(view: MetronomeView): void {
    if (!this.isOpen()) return;
    const setup = this.mode === 'setup';
    this.title.textContent = setup ? 'Set up the metronome' : 'Metronome';
    this.setupEl.hidden = !setup;
    this.tunedEl.hidden = setup;
    // Setup: live row + Beats per bar under the pad; tuned: in its own order.
    if (setup) this.setupEl.append(this.liveRow, this.sigRow);
    else this.tunedEl.append(this.liveRow, this.sigRow, this.retapRow);

    this.switchBtn.hidden = !view.ready;
    this.switchBtn.classList.toggle('active', view.enabled);
    this.switchBtn.setAttribute('aria-checked', String(view.enabled));

    // Steps: done / current / to do.
    const stage = !view.playing && view.taps === 0 ? 0 : view.taps < 4 ? 1 : 2;
    this.steps.forEach((li, i) => {
      li.classList.toggle('done', i < stage);
      li.classList.toggle('current', i === stage);
    });
    if (!view.playing) {
      this.padBig.textContent = 'Play';
      this.padSub.textContent = 'Tap to play the song, then tap on every beat';
    } else if (view.taps < 2) {
      this.padBig.textContent = 'Tap';
      this.padSub.textContent = view.taps ? '1 tap · keep going' : 'on every beat';
    } else {
      this.padBig.textContent = String(view.bpm ?? '');
      this.padSub.textContent = `BPM · ${view.taps} taps · tap on the beat`;
    }

    this.bpmEl.textContent = view.bpm === null ? '–' : String(view.bpm);
    this.offsetEl.textContent = `${view.offsetMs > 0 ? '+' : ''}${view.offsetMs} ms`;

    this.playBtn.innerHTML = view.playing ? PAUSE : PLAY;
    this.playBtn.setAttribute('aria-label', view.playing ? 'Pause' : 'Play');
    this.timeEl.textContent = `${view.playing ? 'Playing' : 'Paused'} · ${view.time}`;

    for (const btn of this.sigBtns) btn.classList.toggle('active', btn.textContent === view.timeSig);
    const count = parseInt(view.timeSig.split('/')[0] ?? '4', 10);
    if (count !== this.beatCount) {
      this.beatCount = count;
      this.beatsEl.replaceChildren(...Array.from({ length: count }, (_, i) => el('span', i === 0 ? 'metro-beat first' : 'metro-beat')));
      this.beat = null;
    }
  }

  /** Light the beat being played (0 = beat 1), or none. */
  setBeat(beat: number | null): void {
    if (beat === this.beat || !this.isOpen()) return;
    this.beat = beat;
    Array.from(this.beatsEl.children).forEach((dot, i) => dot.classList.toggle('on', i === beat));
  }

  setTime(text: string, playing: boolean): void {
    if (!this.isOpen()) return;
    const next = `${playing ? 'Playing' : 'Paused'} · ${text}`;
    if (this.timeEl.textContent !== next) this.timeEl.textContent = next;
  }
}
