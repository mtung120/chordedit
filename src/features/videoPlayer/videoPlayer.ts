/**
 * Practice panel: audio source (YouTube search / mp3 upload), transport,
 * stems, speed, pitch and metronome.
 *
 * Architecture: Tone.js plays all audio, from the mp3 the server downloads
 * (yt-dlp) or the uploaded file; there is no embedded video (removed
 * 2026-10-27 — the source title links to it on YouTube). Playback position
 * is derived from two variables: playStartTime (Tone.now() at last
 * play/resume) and playStartOffset (song position at that moment).
 *
 * Nothing loads until Practice first opens (loadAudio), and vocals /
 * backing load on their first pick: decoded audio is large, and iOS
 * restarts a Home Screen web app that holds too much (back to the library).
 */

import { downloadAudio, getStemStatus, saveMetronomeSettings, saveYouTubeSettings, separateStems, uploadAudio, youtubeSearch } from '../../api/client.js';
import type { YouTubeSearchResultItem } from '../../api/types.js';
import { ROUTES } from '../../routes.js';
import { get as getSongMeta } from '../../state/songMetaStore.js';
import { MetronomeSheet } from './metronomeSheet.js';
import type { MetronomeView } from './metronomeSheet.js';
import { fitTaps } from './tapTempo.js';

type ToneModule = typeof import('tone');

// Tone.js loads with the audio, the first time Practice opens (see
// loadAudio). The actual AudioContext is created on first user gesture.
let tonePromise: Promise<ToneModule> | null = null;

const MIN_SPEED = 50; // %
const MAX_SPEED = 120;
/** Taps further apart than this (song seconds) start a new run. */
const TAP_GAP_S = 2;
const MAX_TAPS = 16;

const MIN_PITCH = -6;
const MAX_PITCH = 6;

/** Circular arrow with a "5" in it (iOS go-back / go-forward style). */
const SEEK_ICON = (forward: boolean): string =>
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
  (forward
    ? '<path d="M12 5.5a7.5 7.5 0 1 0 7.5 7.5"/><path d="M9.5 3 12 5.5 9.5 8"/>'
    : '<path d="M12 5.5a7.5 7.5 0 1 1-7.5 7.5"/><path d="M14.5 3 12 5.5l2.5 2.5"/>') +
  '<text x="12" y="13.2" text-anchor="middle" dominant-baseline="middle" fill="currentColor" stroke="none" font-size="8" font-weight="600" font-family="inherit">5</text></svg>';

/** A setting's label + its Reset: one line above the control on touch
 *  screens; on desktop (display: contents) Reset moves after the control. */
function rowHead(label: HTMLElement, reset: HTMLElement): HTMLDivElement {
  const head = document.createElement('div');
  head.className = 'vp-row-head';
  head.append(label, reset);
  return head;
}

class VideoPlayerWidget {
  private songName: string;

  // ─── Playback state (minimal) ──────────────────────────────────────────
  private playStartTime = 0;       // Tone.now() when play/resume was clicked
  private playStartOffset = 0;     // song position at that moment
  private duration = 0;
  private rafId: number | null = null; // non-null = playing

  // ─── Audio state ───────────────────────────────────────────────────────
  private Tone: ToneModule | null = null;
  /** Currently active player (points into playerCache). */
  private player: InstanceType<ToneModule['Player']> | null = null;
  /** Pre-created players keyed by stem type. Swap is instant — no decode. */
  private playerCache = new Map<string, InstanceType<ToneModule['Player']>>();
  private pitchShiftNode: InstanceType<ToneModule['PitchShift']> | null = null;
  private currentPitch = 0;
  private currentSpeed = 1.0;
  private currentStem: 'full' | 'vocals' | 'accompaniment' = 'full';

  // ─── YouTube state ─────────────────────────────────────────────────────
  private videoId = '';
  private videoTitle = '';

  // ─── Audio source ──────────────────────────────────────────────────────
  private audioSource = '';          // "youtube", "upload", or ""
  private uploadedAudioName = '';

  // ─── Metadata audio filenames ──────────────────────────────────────────
  private fullMp3Audio = '';
  private vocalAudio = '';
  private instrumentAudio = '';

  // ─── DOM elements ──────────────────────────────────────────────────────
  private modeToggle!: HTMLDivElement;
  private ytTabBtn!: HTMLButtonElement;
  private uploadTabBtn!: HTMLButtonElement;
  private searchBar!: HTMLDivElement;
  private uploadBar!: HTMLDivElement;
  private fileInput!: HTMLInputElement;
  private uploadBtn!: HTMLButtonElement;
  /** Source picker (mode toggle + search / upload + results). */
  private setupEl!: HTMLDivElement;
  /** "Source: <title> · Hide video · Change" line, shown once a source is set. */
  private sourceRow!: HTMLDivElement;
  private sourceTitleEl!: HTMLAnchorElement;
  private changeVideoBtn!: HTMLButtonElement;
  private cancelSetupBtn!: HTMLButtonElement;
  private searchInput!: HTMLInputElement;
  private searchBtn!: HTMLButtonElement;
  private resultsEl!: HTMLDivElement;
  private statusEl!: HTMLDivElement;
  private controlsRow!: HTMLDivElement;
  private playBtn!: HTMLButtonElement;
  private scrubber!: HTMLInputElement;
  private timeEl!: HTMLSpanElement;
  private pitchDisplay!: HTMLSpanElement;
  private stemRow!: HTMLDivElement;
  private stemBtns: HTMLButtonElement[] = [];
  private stemSeg!: HTMLDivElement;
  private pitchResetBtn!: HTMLButtonElement;
  private separateBtn!: HTMLButtonElement;
  private separateSeg!: HTMLDivElement;
  /** Bumped on every video change so a stale stem poll stops. */
  private stemPollGen = 0;
  private audioRequested = false;
  /** Set while a stem's audio is being fetched + decoded (first pick). */
  private stemLoading = false;
  private speedSlider!: HTMLInputElement;
  private speedValueEl!: HTMLSpanElement;
  private speedResetBtn!: HTMLButtonElement;

  private userDragging = false;
  private wasPlayingBeforeDrag = false;

  // ─── Metronome state ──────────────────────────────────────────────────
  private metronomeBpm: number | null = null;
  private metronomeAnchor: number | null = null;
  private metronomeTimeSig: string | null = null;
  /** Clicks nudged earlier (<0) / later (>0) than the tapped anchor, ms. */
  private metronomeOffsetMs = 0;
  private metronomeEnabled = false;
  private lastScheduledN = -1;
  /** Song positions of the taps in the current run (seconds). */
  private tapPositions: number[] = [];
  private metronomeToggleBtn!: HTMLButtonElement;
  private metronomeChip!: HTMLButtonElement;
  private metronomeChipText!: HTMLSpanElement;
  private metronomeSheet!: MetronomeSheet;
  private metronomeSaveDebounce: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly container: HTMLElement) {
    this.songName = window.songName ?? '';
  }

  async init(): Promise<void> {
    const meta = await getSongMeta();
    this.videoId = meta.youtubeVideoId || '';
    this.videoTitle = meta.youtubeVideoTitle || '';
    this.audioSource = meta.audioSource || '';
    this.uploadedAudioName = meta.uploadedAudioName || '';
    this.fullMp3Audio = meta.fullMp3Audio || '';
    this.vocalAudio = meta.vocalAudio || '';
    this.instrumentAudio = meta.instrumentAudio || '';

    // Load persisted metronome settings
    const metro = meta.metronome;
    if (metro) {
      if (metro.bpm) this.metronomeBpm = metro.bpm;
      if (metro.timeSignature) this.metronomeTimeSig = metro.timeSignature;
      if (metro.beatAnchor != null) this.metronomeAnchor = metro.beatAnchor;
      this.metronomeOffsetMs = metro.offsetMs ?? 0;
    }
    if (this.isMetronomeReady()) this.metronomeEnabled = true;

    this.render();
  }

  /**
   * Fetch and decode the song's audio — once, the first time Practice opens.
   * Decoded audio is large (~90 MB per track for a 4-minute song), and iOS
   * reloads a Home Screen web app that uses too much memory, which lands it
   * back on the library; so Perform and Edit don't hold any.
   */
  loadAudio(): void {
    if (this.audioRequested) return;
    this.audioRequested = true;
    if (this.audioSource) void this.onVideoSet(/* isPageLoad */ true);
  }

  // ─── Render ────────────────────────────────────────────────────────────

  private render(): void {
    this.container.innerHTML = '';

    // ─── Source picker: "Source [YouTube | Upload mp3] … Cancel", then the
    // search field (prefilled with the title) or the mp3 picker, then results.
    this.modeToggle = document.createElement('div');
    this.modeToggle.className = 'vp-seg vp-mode-toggle';

    this.ytTabBtn = document.createElement('button');
    this.ytTabBtn.type = 'button';
    this.ytTabBtn.textContent = 'YouTube';
    this.ytTabBtn.classList.add('active');
    this.ytTabBtn.addEventListener('click', () => this.switchTab('youtube'));

    this.uploadTabBtn = document.createElement('button');
    this.uploadTabBtn.type = 'button';
    this.uploadTabBtn.textContent = 'Upload mp3';
    this.uploadTabBtn.addEventListener('click', () => this.switchTab('upload'));

    this.modeToggle.append(this.ytTabBtn, this.uploadTabBtn);

    // ─── YouTube search bar ─────────────────────────────────────────
    this.searchBar = document.createElement('div');
    this.searchBar.className = 'yt-search-bar';
    this.searchInput = document.createElement('input');
    this.searchInput.type = 'search';
    this.searchInput.className = 'yt-search-input';
    this.searchInput.placeholder = 'Search YouTube';
    this.searchInput.setAttribute('aria-label', 'Search YouTube');
    this.searchInput.enterKeyHint = 'search';
    this.searchInput.autocomplete = 'off';
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void this.search();
    });
    this.searchBtn = document.createElement('button');
    this.searchBtn.type = 'button';
    this.searchBtn.className = 'vp-btn yt-search-btn';
    this.searchBtn.textContent = 'Search';
    this.searchBtn.addEventListener('click', () => void this.search());
    this.searchBar.append(this.searchInput, this.searchBtn);

    // ─── Upload bar ─────────────────────────────────────────────────
    this.uploadBar = document.createElement('div');
    this.uploadBar.className = 'vp-upload-bar';
    this.uploadBar.hidden = true; // YouTube tab is the default

    // The native file input is hidden; a filled "Choose an mp3" label opens
    // it and then shows the file's name.
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.id = 'vp-file';
    this.fileInput.accept = '.mp3,audio/mpeg';
    this.fileInput.className = 'vp-file-input vp-visually-hidden';
    const filePick = document.createElement('label');
    filePick.className = 'vp-file-pick';
    filePick.htmlFor = 'vp-file';
    const fileName = document.createElement('span');
    fileName.className = 'vp-file-name';
    fileName.textContent = 'Choose an mp3';
    filePick.append(fileName);
    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0];
      fileName.textContent = file ? file.name : 'Choose an mp3';
      this.uploadBtn.disabled = !file;
    });

    this.uploadBtn = document.createElement('button');
    this.uploadBtn.type = 'button';
    this.uploadBtn.className = 'vp-btn vp-upload-btn';
    this.uploadBtn.textContent = 'Upload';
    this.uploadBtn.disabled = true;
    this.uploadBtn.addEventListener('click', () => void this.handleUpload());
    this.uploadBar.append(this.fileInput, filePick, this.uploadBtn);

    // Results
    this.resultsEl = document.createElement('div');
    this.resultsEl.className = 'yt-results';
    this.resultsEl.hidden = true;

    this.cancelSetupBtn = document.createElement('button');
    this.cancelSetupBtn.type = 'button';
    this.cancelSetupBtn.className = 'vp-link-btn vp-cancel-setup';
    this.cancelSetupBtn.textContent = 'Cancel';
    this.cancelSetupBtn.addEventListener('click', () => this.setSetupOpen(false));

    const setupHead = document.createElement('div');
    setupHead.className = 'vp-setup-head';
    const setupLabel = document.createElement('span');
    setupLabel.className = 'vp-row-label';
    setupLabel.textContent = 'Source';
    setupHead.append(setupLabel, this.modeToggle, this.cancelSetupBtn);

    this.setupEl = document.createElement('div');
    this.setupEl.className = 'vp-setup';
    this.setupEl.append(setupHead, this.searchBar, this.uploadBar, this.resultsEl);

    // All playback controls in one container — shown/hidden together.
    // Order: transport · stems · speed + pitch · metronome.
    this.controlsRow = document.createElement('div');
    this.controlsRow.className = 'yt-controls';
    this.controlsRow.hidden = true;
    this.buildMediaControls(this.controlsRow);
    const settings = document.createElement('div');
    settings.className = 'vp-settings';
    this.buildStemButtons(settings);
    const pair = document.createElement('div');
    pair.className = 'vp-row-pair';
    this.buildSpeedControls(pair);
    this.buildPitchControls(pair);
    settings.appendChild(pair);
    this.buildMetronomeControls(settings);
    this.controlsRow.appendChild(settings);

    // Source line: "Source: <title>   Change"; a YouTube title links to the video.
    this.sourceRow = document.createElement('div');
    this.sourceRow.className = 'vp-source-row';
    const sourceLabel = document.createElement('span');
    sourceLabel.className = 'vp-row-label';
    sourceLabel.textContent = 'Source';
    this.sourceTitleEl = document.createElement('a');
    this.sourceTitleEl.className = 'vp-source-title';
    this.sourceTitleEl.target = '_blank';
    this.sourceTitleEl.rel = 'noopener';

    this.changeVideoBtn = document.createElement('button');
    this.changeVideoBtn.type = 'button';
    this.changeVideoBtn.className = 'vp-link-btn';
    this.changeVideoBtn.textContent = 'Change';
    this.changeVideoBtn.addEventListener('click', () => this.setSetupOpen(true, true));

    this.sourceRow.append(sourceLabel, this.sourceTitleEl, this.changeVideoBtn);

    // Shared status line at the bottom
    this.statusEl = document.createElement('div');
    this.statusEl.className = 'vp-status';

    this.container.append(
      this.sourceRow,
      this.setupEl,
      this.controlsRow,
      this.statusEl,
    );
    this.setSetupOpen(!this.audioSource);
    this.updateSourceRow();
    this.announceTempo();
  }

  /** Show the source picker (no source yet, or "Change") or the source line. */
  private setSetupOpen(open: boolean, focus = false): void {
    this.setupEl.hidden = !open;
    this.sourceRow.hidden = open;
    this.cancelSetupBtn.hidden = !this.audioSource;
    if (open) this.switchTab('youtube');
    // Most searches are for the song itself: start from its title.
    if (open && !this.searchInput.value) {
      this.searchInput.value = document.getElementById('song-title-heading')?.dataset.title ?? '';
    }
    if (open && focus) this.searchInput.focus();
  }

  private updateSourceRow(): void {
    const youtube = this.audioSource === 'youtube' && this.videoId;
    this.sourceTitleEl.textContent = youtube ? this.videoTitle : this.uploadedAudioName;
    if (youtube) this.sourceTitleEl.href = `https://www.youtube.com/watch?v=${encodeURIComponent(this.videoId)}`;
    else this.sourceTitleEl.removeAttribute('href');
  }

  private switchTab(tab: 'youtube' | 'upload'): void {
    const isYt = tab === 'youtube';
    this.ytTabBtn.classList.toggle('active', isYt);
    this.uploadTabBtn.classList.toggle('active', !isYt);
    this.searchBar.hidden = !isYt;
    this.uploadBar.hidden = isYt;
    this.resultsEl.hidden = true;
  }

  private async handleUpload(): Promise<void> {
    const file = this.fileInput.files?.[0];
    if (!file) return;
    this.uploadBtn.disabled = true;
    this.uploadBtn.textContent = 'Uploading…';
    this.setStatus('Uploading audio…');
    try {
      await uploadAudio(this.songName, file);
      this.audioSource = 'upload';
      this.uploadedAudioName = file.name;
      this.videoId = '';
      this.videoTitle = '';
      this.updateSourceRow();
      this.setSetupOpen(false);
      // Audio is already on disk — go straight to ready
      await this.refreshMetadata();
      await this.onAudioReady();
    } catch (err) {
      this.setStatus(`Upload failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.uploadBtn.disabled = !this.fileInput.files?.length;
      this.uploadBtn.textContent = 'Upload';
    }
  }

  private buildMediaControls(root: HTMLElement): void {
    const row = document.createElement('div');
    row.className = 'vp-row vp-playback-row';

    this.playBtn = document.createElement('button');
    this.playBtn.type = 'button';
    this.playBtn.className = 'vp-btn yt-play-btn';
    this.setPlayIcon(false);
    this.playBtn.addEventListener('click', () => this.onPlayPauseClick());

    this.scrubber = document.createElement('input');
    this.scrubber.type = 'range';
    this.scrubber.className = 'yt-scrubber';
    this.scrubber.min = '0';
    this.scrubber.max = '0';
    this.scrubber.step = '0.1';
    this.scrubber.value = '0';
    this.scrubber.addEventListener('input', () => {
      this.paintScrubber();
      this.onScrubberInput();
    });
    this.scrubber.addEventListener('change', () => this.onScrubberChange());

    this.timeEl = document.createElement('span');
    this.timeEl.className = 'yt-time';
    this.timeEl.textContent = '0:00 / 0:00';

    const seekBackBtn = document.createElement('button');
    seekBackBtn.type = 'button';
    seekBackBtn.className = 'vp-btn yt-seek-btn';
    seekBackBtn.setAttribute('aria-label', 'Back 5 seconds');
    seekBackBtn.innerHTML = SEEK_ICON(false);
    seekBackBtn.addEventListener('click', () => this.seek(-5));

    const seekFwdBtn = document.createElement('button');
    seekFwdBtn.type = 'button';
    seekFwdBtn.className = 'vp-btn yt-seek-btn';
    seekFwdBtn.setAttribute('aria-label', 'Forward 5 seconds');
    seekFwdBtn.innerHTML = SEEK_ICON(true);
    seekFwdBtn.addEventListener('click', () => this.seek(5));

    row.append(this.playBtn, seekBackBtn, seekFwdBtn, this.scrubber, this.timeEl);
    root.appendChild(row);
  }

  private buildPitchControls(root: HTMLElement): void {
    const row = document.createElement('div');
    row.className = 'vp-row ps-controls';

    const label = document.createElement('span');
    label.textContent = 'Pitch';
    label.className = 'vp-row-label';

    const minusBtn = document.createElement('button');
    minusBtn.type = 'button';
    minusBtn.textContent = '−';
    minusBtn.className = 'vp-btn ps-btn';
    minusBtn.addEventListener('click', () => this.adjustPitch(-1));

    this.pitchDisplay = document.createElement('span');
    this.pitchDisplay.className = 'ps-display';
    this.pitchDisplay.textContent = '0';

    const plusBtn = document.createElement('button');
    plusBtn.type = 'button';
    plusBtn.textContent = '+';
    plusBtn.className = 'vp-btn ps-btn';
    plusBtn.addEventListener('click', () => this.adjustPitch(1));

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.textContent = 'Reset';
    resetBtn.className = 'vp-btn vp-reset ps-reset';
    resetBtn.addEventListener('click', () => this.adjustPitch(-this.currentPitch));

    resetBtn.hidden = true; // only while the pitch is shifted
    this.pitchResetBtn = resetBtn;

    const stepper = document.createElement('div');
    stepper.className = 'vp-seg vp-stepper';
    stepper.append(minusBtn, this.pitchDisplay, plusBtn);
    row.append(rowHead(label, resetBtn), stepper);
    root.appendChild(row);
  }

  private buildStemButtons(root: HTMLElement): void {
    const row = document.createElement('div');
    row.className = 'vp-row stem-selector';
    row.hidden = true; // shown once the full mix is loaded
    this.stemRow = row;

    const label = document.createElement('span');
    label.textContent = 'Stems';
    label.className = 'vp-row-label';
    row.appendChild(label);

    const stems: Array<{ label: string; value: 'full' | 'vocals' | 'accompaniment' }> = [
      { label: 'Full', value: 'full' },
      { label: 'Vocals', value: 'vocals' },
      { label: 'Backing', value: 'accompaniment' },
    ];
    this.stemBtns = [];
    this.stemSeg = document.createElement('div');
    this.stemSeg.className = 'vp-seg';
    row.appendChild(this.stemSeg);
    for (const s of stems) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vp-btn stem-btn';
      btn.textContent = s.label;
      if (s.value === 'full') btn.classList.add('active');
      btn.addEventListener('click', () => void this.onStemClick(s.value));
      this.stemSeg.appendChild(btn);
      this.stemBtns.push(btn);
    }

    // Shown instead of the stem buttons until the server has made stems.
    this.separateBtn = document.createElement('button');
    this.separateBtn.type = 'button';
    this.separateBtn.className = 'vp-btn separate-stems-btn';
    this.separateBtn.textContent = 'Separate stems';
    this.separateBtn.addEventListener('click', () => void this.onSeparateClick());
    this.separateSeg = document.createElement('div');
    this.separateSeg.className = 'vp-seg';
    this.separateSeg.appendChild(this.separateBtn);
    row.appendChild(this.separateSeg);

    root.appendChild(row);
  }

  private buildSpeedControls(root: HTMLElement): void {
    const row = document.createElement('div');
    row.className = 'vp-row speed-selector';

    // "Speed 85%": the value rides in the label.
    const label = document.createElement('label');
    label.className = 'vp-row-label';
    label.htmlFor = 'vp-speed';
    label.textContent = 'Speed ';
    this.speedValueEl = document.createElement('span');
    this.speedValueEl.className = 'vp-row-value';
    label.append(this.speedValueEl);

    this.speedSlider = document.createElement('input');
    this.speedSlider.type = 'range';
    this.speedSlider.id = 'vp-speed';
    this.speedSlider.className = 'yt-scrubber speed-slider';
    this.speedSlider.min = String(MIN_SPEED);
    this.speedSlider.max = String(MAX_SPEED);
    this.speedSlider.step = '5';
    this.speedSlider.addEventListener('input', () => this.onSpeedChange(parseInt(this.speedSlider.value, 10) / 100));

    this.speedResetBtn = document.createElement('button');
    this.speedResetBtn.type = 'button';
    this.speedResetBtn.className = 'vp-btn vp-reset';
    this.speedResetBtn.textContent = 'Reset';
    this.speedResetBtn.addEventListener('click', () => this.onSpeedChange(1));

    row.append(rowHead(label, this.speedResetBtn), this.speedSlider);
    root.appendChild(row);
    this.paintSpeed();
  }

  /** Slider position, "85%", the filled part of the track, Reset. */
  private paintSpeed(): void {
    const pct = Math.round(this.currentSpeed * 100);
    this.speedSlider.value = String(pct);
    this.speedValueEl.textContent = `${pct}%`;
    this.speedSlider.style.setProperty('--progress', `${((pct - MIN_SPEED) / (MAX_SPEED - MIN_SPEED)) * 100}%`);
    this.speedResetBtn.hidden = pct === 100;
  }

  // ─── Metronome controls ───────────────────────────────────────────────
  // The panel shows a switch + "72 BPM · 4/4" (or "Set up"); the chip opens
  // the metronome sheet (metronomeSheet.ts), where tempo, beat 1, a fine
  // nudge and the time signature are set.

  private isMetronomeReady(): boolean {
    return this.metronomeBpm !== null && this.metronomeAnchor !== null && this.metronomeTimeSig !== null;
  }

  /** Beat 1's song position: the tapped anchor plus the nudge. */
  private beatOne(): number | null {
    return this.metronomeAnchor === null ? null : this.metronomeAnchor + this.metronomeOffsetMs / 1000;
  }

  private buildMetronomeControls(root: HTMLElement): void {
    const row = document.createElement('div');
    row.className = 'vp-row metronome-row';

    const label = document.createElement('span');
    label.textContent = 'Metronome';
    label.className = 'vp-row-label';

    this.metronomeToggleBtn = document.createElement('button');
    this.metronomeToggleBtn.type = 'button';
    this.metronomeToggleBtn.className = 'vp-btn metronome-toggle';
    this.metronomeToggleBtn.setAttribute('role', 'switch');
    this.metronomeToggleBtn.setAttribute('aria-label', 'Metronome');
    this.metronomeToggleBtn.addEventListener('click', () => this.onMetronomeToggle());

    this.metronomeChip = document.createElement('button');
    this.metronomeChip.type = 'button';
    this.metronomeChip.className = 'vp-btn metronome-chip';
    this.metronomeChip.setAttribute('aria-haspopup', 'dialog');
    this.metronomeChipText = document.createElement('span');
    this.metronomeChipText.className = 'metronome-chip-text';
    this.metronomeChip.innerHTML =
      '<svg class="metronome-chip-chevron" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
    this.metronomeChip.prepend(this.metronomeChipText);
    this.metronomeChip.addEventListener('click', () => {
      if (!this.isMetronomeReady()) this.tapPositions = [];
      this.metronomeSheet.open(this.metronomeView(), this.metronomeChip);
    });

    const controls = document.createElement('div');
    controls.className = 'metronome-controls';
    controls.append(this.metronomeToggleBtn, this.metronomeChip);
    row.append(label, controls);
    root.appendChild(row);

    this.metronomeSheet = new MetronomeSheet({
      toggle: () => this.onMetronomeToggle(),
      tap: () => this.onPadTap(),
      playPause: () => this.onPlayPauseClick(),
      bpmBy: (d) => this.setMetronome({ bpm: Math.min(300, Math.max(20, (this.metronomeBpm ?? 120) + d)) }),
      nudge: (ms) => this.setMetronome({ offsetMs: Math.min(500, Math.max(-500, this.metronomeOffsetMs + ms)) }),
      setTimeSig: (sig) => this.setMetronome({ timeSig: sig }),
      retap: () => {
        this.tapPositions = [];
        this.refreshMetronome();
      },
    });
    this.refreshMetronome();
  }

  private metronomeView(): MetronomeView {
    return {
      ready: this.isMetronomeReady(),
      enabled: this.metronomeEnabled,
      bpm: this.metronomeBpm,
      timeSig: this.metronomeTimeSig ?? '4/4',
      offsetMs: this.metronomeOffsetMs,
      playing: this.isPlaying(),
      time: this.fmt(this.getCurrentTime()),
      taps: this.tapPositions.length,
    };
  }

  /** Panel chip + switch, the sheet, and the Perform tempo, from the state. */
  private refreshMetronome(): void {
    const ready = this.isMetronomeReady();
    this.metronomeChipText.textContent = ready ? `${this.metronomeBpm} BPM · ${this.metronomeTimeSig}` : 'Set up';
    this.metronomeChip.classList.toggle('is-setup', !ready);
    this.metronomeToggleBtn.hidden = !ready;
    this.setMetronomeSwitch(this.metronomeEnabled);
    this.metronomeSheet.update(this.metronomeView());
    this.announceTempo();
  }

  private setMetronome(change: { bpm?: number; timeSig?: string; offsetMs?: number }): void {
    if (change.bpm !== undefined) this.metronomeBpm = change.bpm;
    if (change.timeSig !== undefined) this.metronomeTimeSig = change.timeSig;
    if (change.offsetMs !== undefined) this.metronomeOffsetMs = change.offsetMs;
    this.lastScheduledN = -1;
    this.refreshMetronome();
    this.scheduleMetronomeSave();
  }

  /** A switch: the track + knob are CSS; "On" / "Off" is for screen readers. */
  private setMetronomeSwitch(on: boolean): void {
    const btn = this.metronomeToggleBtn;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-checked', String(on));
    btn.innerHTML = `<span class="vp-switch" aria-hidden="true"></span><span class="vp-visually-hidden">${on ? 'On' : 'Off'}</span>`;
  }

  /** Tell songMode the BPM / time signature (shown beside the title in Perform). */
  private announceTempo(): void {
    document.dispatchEvent(new CustomEvent('metronome:change', {
      detail: { bpm: this.metronomeBpm, timeSig: this.metronomeTimeSig },
    }));
  }

  private onMetronomeToggle(): void {
    if (!this.isMetronomeReady()) return;
    this.metronomeEnabled = !this.metronomeEnabled;
    this.lastScheduledN = -1;
    this.refreshMetronome();
  }

  /**
   * The sheet's tap pad. While paused, a tap plays the song. Otherwise each
   * tap is a beat at the song's current position; fitTaps (a line through
   * the whole run) gives the tempo and puts beat 1 on the last tap. Song
   * positions, not wall-clock times, so tapping at 75%
   * speed still measures the record's tempo.
   */
  private onPadTap(): void {
    if (!this.isPlaying()) {
      void this.play();
      return;
    }
    const t = this.getCurrentTime();
    const last = this.tapPositions[this.tapPositions.length - 1];
    if (last !== undefined && (t - last > TAP_GAP_S || t <= last)) this.tapPositions = [];
    this.tapPositions.push(t);
    if (this.tapPositions.length > MAX_TAPS) this.tapPositions.shift();

    const fit = fitTaps(this.tapPositions);
    if (fit) {
      this.metronomeBpm = Math.min(300, Math.max(20, Math.round(60 / fit.interval)));
      this.metronomeAnchor = fit.last;
    } else {
      this.metronomeAnchor = t;
    }
    this.metronomeTimeSig ??= '4/4';
    this.metronomeOffsetMs = 0;
    this.lastScheduledN = -1;

    // Auto-enable once there's a tempo to click to.
    if (this.isMetronomeReady() && !this.metronomeEnabled) this.metronomeEnabled = true;
    this.refreshMetronome();
    this.scheduleMetronomeSave();
  }

  /** Beat dots in the sheet follow the clicks. */
  private paintBeat(currentTime: number): void {
    const one = this.beatOne();
    if (!this.metronomeSheet.isOpen() || one === null || this.metronomeBpm === null || !this.isPlaying()) {
      this.metronomeSheet.setBeat(null);
      return;
    }
    const perBar = parseInt((this.metronomeTimeSig ?? '4/4').split('/')[0] ?? '4', 10);
    const n = Math.floor((currentTime - one) / (60 / this.metronomeBpm) + 0.02);
    this.metronomeSheet.setBeat(((n % perBar) + perBar) % perBar);
  }

  private scheduleMetronomeClick(currentTime: number): void {
    if (!this.metronomeEnabled || this.metronomeBpm === null || this.metronomeAnchor === null || this.metronomeTimeSig === null) return;
    if (!this.rawCtx) return;

    const one = this.metronomeAnchor + this.metronomeOffsetMs / 1000;
    const interval = 60 / this.metronomeBpm;
    const n = Math.ceil((currentTime - one) / interval);
    if (n === this.lastScheduledN) return;

    const nextBeatTime = one + n * interval;
    const distance = nextBeatTime - currentTime;
    if (distance > 0.05) return;

    const beatsPerMeasure = parseInt(this.metronomeTimeSig.split('/')[0] ?? '4', 10);
    const isAccent = ((n % beatsPerMeasure) + beatsPerMeasure) % beatsPerMeasure === 0;
    this.metronomeClick(isAccent, this.rawCtx.currentTime + distance / this.currentSpeed);
    this.lastScheduledN = n;
  }

  private metronomeClick(isAccent: boolean, time: number): void {
    if (!this.rawCtx) return;
    const osc = this.rawCtx.createOscillator();
    const gain = this.rawCtx.createGain();
    osc.connect(gain);
    gain.connect(this.rawCtx.destination);

    if (isAccent) {
      osc.type = 'triangle';
      osc.frequency.value = 1200;
      gain.gain.setValueAtTime(0.8, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);
      osc.start(time);
      osc.stop(time + 0.09);
    } else {
      osc.type = 'square';
      osc.frequency.value = 800;
      gain.gain.setValueAtTime(0.18, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
      osc.start(time);
      osc.stop(time + 0.05);
    }
  }

  private scheduleMetronomeSave(): void {
    if (this.metronomeSaveDebounce !== null) clearTimeout(this.metronomeSaveDebounce);
    this.metronomeSaveDebounce = setTimeout(() => void this.saveMetronomeSettings(), 800);
  }

  private async saveMetronomeSettings(): Promise<void> {
    if (!this.songName || this.metronomeBpm === null || !this.metronomeTimeSig) return;
    try {
      const req: Parameters<typeof saveMetronomeSettings>[0] = {
        songName: this.songName,
        bpm: this.metronomeBpm,
        timeSignature: this.metronomeTimeSig,
      };
      if (this.metronomeAnchor !== null) req.beatAnchor = this.metronomeAnchor;
      if (this.metronomeOffsetMs) req.offsetMs = this.metronomeOffsetMs;
      await saveMetronomeSettings(req);
    } catch (err) {
      console.error('metronome save failed', err);
    }
  }

  // ─── YouTube search UI ─────────────────────────────────────────────────

  private async search(): Promise<void> {
    const q = this.searchInput.value.trim();
    if (!q) return;
    this.setStatus('');
    this.searchBtn.disabled = true;
    this.searchBtn.textContent = 'Searching…';
    try {
      const results = await youtubeSearch(q);
      this.showResults(results);
    } catch (err) {
      this.setStatus(`Search failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.searchBtn.disabled = false;
      this.searchBtn.textContent = 'Search';
    }
  }

  private showResults(results: YouTubeSearchResultItem[]): void {
    this.resultsEl.innerHTML = '';
    if (!results || results.length === 0) {
      this.resultsEl.innerHTML = '<div class="yt-no-results">No videos found</div>';
    } else {
      for (const r of results) {
        const item = document.createElement('div');
        item.className = 'yt-result-item';

        const thumb = document.createElement('img');
        thumb.className = 'yt-result-thumb';
        thumb.src = r.thumbnail || '';
        thumb.alt = '';
        thumb.loading = 'lazy';

        const meta = document.createElement('div');
        meta.className = 'yt-result-meta';
        const title = document.createElement('div');
        title.className = 'yt-result-title';
        title.textContent = r.title;
        const chan = document.createElement('div');
        chan.className = 'yt-result-channel';
        chan.textContent = r.channel;
        meta.append(title, chan);

        item.append(thumb, meta);
        item.addEventListener('click', () => void this.pickResult(r));
        this.resultsEl.appendChild(item);
      }
    }
    this.resultsEl.hidden = false;
  }

  private async pickResult(result: YouTubeSearchResultItem): Promise<void> {
    this.resultsEl.hidden = true;
    this.videoId = result.videoId;
    this.videoTitle = result.title;
    this.audioSource = 'youtube';
    this.uploadedAudioName = '';

    this.updateSourceRow();
    this.setSetupOpen(false);

    // Save settings (new video pick — backend also sets audioSource)
    try {
      await saveYouTubeSettings({
        songName: this.songName,
        videoId: result.videoId,
        title: result.title,
      });
    } catch { /* ignore */ }

    // Clear old audio metadata since backend cleared them
    this.fullMp3Audio = '';
    this.vocalAudio = '';
    this.instrumentAudio = '';

    this.audioRequested = true;
    void this.onVideoSet(/* isPageLoad */ false);
  }

  // ─── Video set / change flow ───────────────────────────────────────────

  private async onVideoSet(isPageLoad: boolean): Promise<void> {
    // 1. Disable all controls
    this.disableControls();

    // 2. Reset playback state
    this.stemPollGen++;
    this.stemRow.hidden = true;
    this.stopPlayback();
    this.playStartOffset = 0;
    this.scrubber.value = '0';
    this.scrubber.max = '0';
    this.paintScrubber();
    this.timeEl.textContent = '0:00 / 0:00';
    this.disposeAllPlayers();

    // 3. If we already know the audio file, check if it exists
    if (isPageLoad && this.fullMp3Audio) {
      try {
        const res = await fetch(ROUTES.audio(this.fullMp3Audio), { method: 'HEAD' });
        if (res.ok) {
          await this.onAudioReady();
          return;
        }
      } catch { /* file doesn't exist, trigger download */ }
    }

    // 4. Uploaded audio is already on disk — go straight to ready
    if (this.audioSource === 'upload') {
      await this.refreshMetadata();
      await this.onAudioReady();
      return;
    }

    // 5. Trigger yt-dlp download (YouTube sources only)
    this.setStatus('Downloading audio…');
    try {
      const res = await downloadAudio({ videoId: this.videoId, songName: this.songName });
      if (res.status === 'ready' && res.url) {
        // Re-fetch metadata to get the audio filename
        await this.refreshMetadata();
        await this.onAudioReady();
        return;
      }
      if (res.status === 'error') {
        this.setStatus(`Audio download failed: ${res.error}`);
        return;
      }
    } catch (err) {
      this.setStatus(`Audio download failed: ${err instanceof Error ? err.message : err}`);
      return;
    }

    // 6. Poll until ready
    await this.pollForAudio();
  }

  private async pollForAudio(): Promise<void> {
    const audioFilename = 'youtube/' + this.videoId + '_full.mp3';
    const url = ROUTES.audio(audioFilename);
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const res = await fetch(url, { method: 'HEAD' });
        if (res.ok) {
          await this.refreshMetadata();
          await this.onAudioReady();
          return;
        }
      } catch { /* keep polling */ }
    }
    this.setStatus('Audio download timed out.');
  }

  private async refreshMetadata(): Promise<void> {
    try {
      const slug = window.songName;
      if (!slug) return;
      const { getSongMeta: fetchMeta } = await import('../../api/client.js');
      const meta = await fetchMeta(slug);
      this.audioSource = meta.audioSource || '';
      this.uploadedAudioName = meta.uploadedAudioName || '';
      this.fullMp3Audio = meta.fullMp3Audio || '';
      this.vocalAudio = meta.vocalAudio || '';
      this.instrumentAudio = meta.instrumentAudio || '';
    } catch { /* ignore */ }
  }

  private async onAudioReady(): Promise<void> {
    const audioFilename = this.fullMp3Audio || (this.videoId + '_full.mp3');
    this.currentStem = 'full';

    // 1. Full mix first — enables playback + pitch controls
    this.setStatus('Preparing audio playback…');
    try {
      await this.createCachedPlayer('full', ROUTES.audio(audioFilename));
    } catch (err) {
      this.setStatus(`Audio load failed: ${err instanceof Error ? err.message : err}`);
      return;
    }

    this.player = this.playerCache.get('full') ?? null;
    if (!this.player) return;

    this.duration = this.player.buffer?.duration ?? 0;
    this.scrubber.max = String(this.duration);
    this.enableControls();

    // 2. Stems in parallel in the background — enables stem selection when done
    const hasStems = this.vocalAudio || this.instrumentAudio;
    if (hasStems) {
      this.loadStems();
    } else {
      this.setStatus('Unmute / turn off silent mode to hear audio');
      void this.offerSeparation();
    }
  }

  /** Show the stem row with either the stem buttons or "Separate stems". */
  private showStemRow(haveStems: boolean): void {
    this.stemRow.hidden = false;
    this.stemSeg.hidden = !haveStems;
    for (const btn of this.stemBtns) btn.hidden = !haveStems;
    this.separateSeg.hidden = haveStems;
  }

  private async offerSeparation(): Promise<void> {
    const gen = this.stemPollGen;
    this.setSeparating(false);
    this.showStemRow(false);
    try {
      const res = await getStemStatus(this.songName);
      // A job started earlier (e.g. before a reload) — pick it back up.
      if (res.status === 'separating' && gen === this.stemPollGen) void this.pollStems();
    } catch { /* button stays available */ }
  }

  private async onSeparateClick(): Promise<void> {
    this.setSeparating(true);
    try {
      const res = await separateStems(this.songName);
      if (res.status === 'ready') {
        await this.onStemsReady();
        return;
      }
    } catch (err) {
      this.setSeparating(false);
      this.setStatus(`Stem separation failed: ${err instanceof Error ? err.message : err}`);
      return;
    }
    await this.pollStems();
  }

  /** Poll the server until the job finishes. Demucs takes about as long as the song. */
  private async pollStems(): Promise<void> {
    const gen = this.stemPollGen;
    this.setSeparating(true);
    for (;;) {
      await new Promise((r) => setTimeout(r, 5000));
      if (gen !== this.stemPollGen) return; // video changed
      let res;
      try {
        res = await getStemStatus(this.songName);
      } catch { continue; /* transient network error */ }
      if (res.status === 'separating') continue;
      if (res.status === 'ready') {
        await this.onStemsReady();
        return;
      }
      // "error", or "none" if the server restarted mid-job.
      this.setSeparating(false);
      this.setStatus(res.status === 'error' ? `Stem separation failed: ${res.error}` : 'Stem separation stopped.');
      return;
    }
  }

  private setSeparating(on: boolean): void {
    this.separateBtn.disabled = on;
    this.separateBtn.textContent = on ? 'Separating…' : 'Separate stems';
    if (on) this.setStatus('Separating stems… this takes a few minutes.');
  }

  private async onStemsReady(): Promise<void> {
    await this.refreshMetadata();
    this.loadStems();
  }

  /** Offer Full / Vocals / Backing. A stem's audio loads the first time it's
   *  picked (onStemClick), not up front: each decoded track is ~90 MB. */
  private loadStems(): void {
    this.setStatus('Unmute / turn off silent mode to hear audio');
    this.showStemRow(true);
    this.stemBtns[1]!.disabled = !this.vocalAudio;
    this.stemBtns[2]!.disabled = !this.instrumentAudio;
  }

  // ─── Tone.js ───────────────────────────────────────────────────────────

  private async ensureTone(): Promise<ToneModule> {
    if (this.Tone) return this.Tone;
    this.Tone = await (tonePromise ??= import('tone'));
    return this.Tone;
  }

  /** Raw AudioContext from Tone.js — used by metronome for oscillator scheduling. */
  private get rawCtx(): AudioContext | null {
    return this.Tone ? this.Tone.getContext().rawContext as AudioContext : null;
  }

  /** Create a Tone.Player from URL, let Tone.js fetch + decode, and cache it. */
  private async createCachedPlayer(key: string, url: string): Promise<void> {
    const Tone = await this.ensureTone();
    if (!this.pitchShiftNode) {
      this.pitchShiftNode = new Tone.PitchShift({ pitch: this.currentPitch }).toDestination();
    }
    const p = new Tone.Player(url).connect(this.pitchShiftNode);
    await Tone.loaded();
    if (!p.loaded) {
      p.dispose();
      throw new Error(`could not load ${url}`);
    }
    this.playerCache.set(key, p);
  }

  private disposeAllPlayers(): void {
    if (this.player) {
      try { this.player.stop(); } catch { /* */ }
    }
    this.player = null;
    for (const p of this.playerCache.values()) {
      try { p.stop(); } catch { /* */ }
      p.dispose();
    }
    this.playerCache.clear();
    if (this.pitchShiftNode) {
      this.pitchShiftNode.dispose();
      this.pitchShiftNode = null;
    }
  }

  /** Tear down everything — called on page unload to prevent audio bleeding. */
  destroy(): void {
    this.stopPlayback();
    this.disposeAllPlayers();
    // Close the underlying Web Audio context so no scheduled audio can resume
    try {
      const raw = this.Tone?.getContext().rawContext;
      if (raw && raw instanceof AudioContext && raw.state !== 'closed') {
        void raw.close();
      }
    } catch { /* */ }
  }

  // ─── Play / Pause ──────────────────────────────────────────────────────

  private onPlayPauseClick(): void {
    if (this.isPlaying()) {
      this.pause();
    } else {
      void this.play();
    }
  }

  private isPlaying(): boolean {
    return this.rafId !== null;
  }

  private async play(): Promise<void> {
    if (!this.player || !this.Tone) return;

    // Ensure Tone context is started (required after user gesture)
    await this.Tone.start();

    const offset = this.playStartOffset;
    const duration = this.player.buffer?.duration ?? 0;
    if (duration === 0) return;

    const clamped = Math.max(0, Math.min(offset, duration - 0.1));

    this.player.playbackRate = this.currentSpeed;
    try { this.player.stop(); } catch { /* may not be started */ }
    this.player.start(this.Tone.now(), clamped);
    this.playStartTime = this.Tone.now();
    this.playStartOffset = clamped;

    this.setStatus('');
    this.setPlayIcon(true);
    this.startTicker();
  }

  private pause(): void {
    if (!this.Tone) return;

    // Capture current position
    this.playStartOffset = this.getCurrentTime();

    this.stopTicker();

    if (this.player) {
      try { this.player.stop(); } catch { /* */ }
    }

    this.setPlayIcon(false);

    // Update display with final position
    this.updateTimeDisplay(this.playStartOffset);
  }

  private stopPlayback(): void {
    this.stopTicker();
    if (this.player) {
      try { this.player.stop(); } catch { /* */ }
    }
    this.setPlayIcon(false);
  }

  // ─── Ticker ────────────────────────────────────────────────────────────

  private startTicker(): void {
    if (this.rafId !== null) return;
    const tick = (): void => {
      this.rafId = requestAnimationFrame(tick);
      const currentTime = this.getCurrentTime();

      // End of song: auto-pause, reset to beginning
      if (currentTime >= this.duration) {
        this.playStartOffset = 0;
        this.stopPlayback();
        this.updateTimeDisplay(0);
        return;
      }

      this.scheduleMetronomeClick(currentTime);
      this.paintBeat(currentTime);
      this.updateTimeDisplay(currentTime);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopTicker(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private getCurrentTime(): number {
    if (!this.Tone) return this.playStartOffset;
    return this.playStartOffset + (this.Tone.now() - this.playStartTime) * this.currentSpeed;
  }

  private updateTimeDisplay(currentTime: number): void {
    if (!this.userDragging) {
      this.scrubber.value = String(currentTime);
      this.paintScrubber();
    }
    this.timeEl.textContent = `${this.fmt(currentTime)} / ${this.fmt(this.duration)}`;
    this.metronomeSheet.setTime(this.fmt(currentTime), this.isPlaying());
  }

  /** The played part of the track is dark (CSS reads --progress). */
  private paintScrubber(): void {
    const max = parseFloat(this.scrubber.max) || 0;
    const pct = max > 0 ? (parseFloat(this.scrubber.value) / max) * 100 : 0;
    this.scrubber.style.setProperty('--progress', `${pct}%`);
  }

  /** ▶ / ❚❚ icons; the text ("▶" / "■") stays for screen readers + specs. */
  private setPlayIcon(playing: boolean): void {
    this.playBtn.classList.toggle('active', playing);
    this.playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    this.playBtn.innerHTML = playing
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg><span class="vp-visually-hidden">■</span>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.6v12.8a1 1 0 0 0 1.5.86l10.2-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6z"/></svg><span class="vp-visually-hidden">▶</span>';
    // The metronome sheet has its own play / pause and tap-pad wording.
    if (this.metronomeSheet) this.metronomeSheet.update({ ...this.metronomeView(), playing });
  }

  private fmt(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds || 0));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r < 10 ? '0' : ''}${r}`;
  }

  // ─── Seek ──────────────────────────────────────────────────────────────

  private seek(delta: number): void {
    const current = this.isPlaying() ? this.getCurrentTime() : this.playStartOffset;
    const target = Math.max(0, Math.min(current + delta, this.duration));
    this.lastScheduledN = -1;
    this.playStartOffset = target;

    if (this.isPlaying()) {
      void this.play();
    } else {
      this.scrubber.value = String(target);
      this.updateTimeDisplay(target);
    }
  }

  // ─── Scrubber ─────────────────────────────────────────────────────────

  private onScrubberInput(): void {
    if (!this.userDragging) {
      // First input event of this drag — capture whether we were playing
      this.wasPlayingBeforeDrag = this.isPlaying();
      this.userDragging = true;
      this.stopTicker(); // don't fight with user's drag
    }
    // Audio and video keep playing normally
  }

  private onScrubberChange(): void {
    const newOffset = parseFloat(this.scrubber.value);
    this.lastScheduledN = -1;
    this.playStartOffset = newOffset;
    this.userDragging = false;

    if (this.wasPlayingBeforeDrag) {
      // Restart at new position
      void this.play();
    } else {
      // Just update display
      this.updateTimeDisplay(newOffset);
    }
  }

  // ─── Pitch controls ───────────────────────────────────────────────────

  private adjustPitch(delta: number): void {
    const newPitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, this.currentPitch + delta));
    if (newPitch === this.currentPitch) return;
    this.currentPitch = newPitch;
    this.updatePitchDisplay();
    this.applyPitchToNode();
  }

  private updatePitchDisplay(): void {
    const v = this.currentPitch;
    this.pitchDisplay.textContent = v > 0 ? `+${v}` : `${v}`;
    this.pitchResetBtn.hidden = v === 0;
  }

  /** Apply manual pitch + speed-compensation to the PitchShift node.
   *  Slowing down lowers pitch; we compensate so the song stays in key. */
  private applyPitchToNode(): void {
    if (!this.pitchShiftNode) return;
    // Playing at another rate shifts the pitch too; undo that.
    const compensation = -12 * Math.log2(this.currentSpeed);
    this.pitchShiftNode.pitch = this.currentPitch + compensation;
  }

  // ─── Speed controls ───────────────────────────────────────────────────

  private onSpeedChange(speed: number): void {
    if (speed === this.currentSpeed) return;

    if (this.isPlaying() && this.Tone) {
      // Re-anchor position so getCurrentTime() stays correct at new speed
      const pos = this.getCurrentTime();
      this.currentSpeed = speed;
      this.playStartOffset = pos;
      this.playStartTime = this.Tone.now();
      if (this.player) this.player.playbackRate = speed;
    } else {
      this.currentSpeed = speed;
    }

    this.applyPitchToNode();
    this.paintSpeed();
  }

  // ─── Stem selection ────────────────────────────────────────────────────

  private async onStemClick(stem: 'full' | 'vocals' | 'accompaniment'): Promise<void> {
    if (stem === this.currentStem || this.stemLoading) return;

    // First pick of a stem: fetch + decode it (a second or two), then keep it.
    if (!this.playerCache.has(stem)) {
      const file = stem === 'vocals' ? this.vocalAudio : stem === 'accompaniment' ? this.instrumentAudio : '';
      if (!file) return;
      const gen = this.stemPollGen;
      this.stemLoading = true;
      this.setStatus(stem === 'vocals' ? 'Preparing vocals…' : 'Preparing backing…');
      try {
        await this.createCachedPlayer(stem, ROUTES.audio(file));
      } catch {
        this.setStatus('Couldn’t load that stem. Try again.');
        return;
      } finally {
        this.stemLoading = false;
      }
      if (gen !== this.stemPollGen) {
        // The source changed meanwhile: this stem belongs to the old one.
        this.playerCache.get(stem)?.dispose();
        this.playerCache.delete(stem);
        return;
      }
      this.setStatus('');
    }
    const cachedPlayer = this.playerCache.get(stem);
    if (!cachedPlayer) return;

    const wasPlaying = this.isPlaying();

    if (wasPlaying) {
      this.playStartOffset = this.getCurrentTime();
      this.stopTicker();
      if (this.player) {
        try { this.player.stop(); } catch { /* */ }
      }
    }

    // Swap to the cached player — instant once loaded
    this.currentStem = stem;
    this.player = cachedPlayer;

    // Update button active states
    const stemValues: Array<'full' | 'vocals' | 'accompaniment'> = ['full', 'vocals', 'accompaniment'];
    for (let i = 0; i < this.stemBtns.length; i++) {
      this.stemBtns[i]!.classList.toggle('active', stemValues[i] === stem);
    }

    if (wasPlaying) {
      void this.play();
    }
  }

  // ─── Enable / Disable controls ─────────────────────────────────────────

  private disableControls(): void {
    this.controlsRow.hidden = true;
  }

  private enableControls(): void {
    this.controlsRow.hidden = false;
  }

  private setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  // ─── Events ────────────────────────────────────────────────────────────

  /** Called when the page leaves Practice mode: stop the track (and with it
   *  the metronome, which only ticks during playback). */
  pauseIfPlaying(): void {
    if (this.isPlaying()) this.pause();
  }
}

// ─── Mount ──────────────────────────────────────────────────────────────────

function mount(): void {
  const container = document.querySelector<HTMLElement>('.video-player-container');
  if (container && window.songName) {
    const widget = new VideoPlayerWidget(container);
    const ready = widget.init();
    // Audio loads the first time Practice opens (songs open in Perform).
    const onMode = (mode: string | undefined): void => {
      if (mode === 'practice') void ready.then(() => widget.loadAudio());
      else widget.pauseIfPlaying();
    };
    onMode(document.body.dataset.mode);
    document.addEventListener('songmode:change', (e) => {
      onMode((e as CustomEvent<{ mode: string }>).detail.mode);
    });

    // Stop all audio when navigating away — prevents bleed into the next page.
    // pagehide fires reliably on both full navigation and bfcache eviction.
    window.addEventListener('pagehide', () => widget.destroy());
  }

  // Hide results when clicking outside the widget
  document.addEventListener('click', (e) => {
    const widget = document.querySelector<HTMLElement>('.video-player-container');
    if (!widget) return;
    const results = widget.querySelector<HTMLElement>('.yt-results');
    if (!results) return;
    if (!widget.contains(e.target as Node)) results.hidden = true;
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
  mount();
}
