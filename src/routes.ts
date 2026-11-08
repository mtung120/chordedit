/**
 * Single source of URL truth for the ChordEdit frontend.
 *
 * Every route the Go server exposes is named here. JS modules import from
 * this file instead of building URL strings inline. Doing so:
 *
 *   1. Makes URL changes refactorable (rename a route, find every caller
 *      via TS compile errors instead of grep + prayer).
 *   2. Eliminates the "/music/desktop/song?songName=" bug class — that
 *      string is no longer in any source file outside this one.
 *   3. Lets the typed API client (src/api/client.ts) constrain which body
 *      type can be sent to which route via TypeScript inference.
 *
 * Functions are used for parameterised URLs (slug-bearing endpoints) so
 * the encoding lives in exactly one place. `as const` on the exported
 * object means each string is its own literal type, not just `string`.
 */

const slug = (s: string) => `?songName=${encodeURIComponent(s)}`;

export const ROUTES = {
  // ── Page routes (HTML responses; navigated to, not fetched) ─────────────
  rootRedirect: '/music/',
  home: '/music/songs',
  /**
   * Song view URL. The optional `setlist` slug enables the Prev/Next overlay
   * (src/features/setlistContext). Only the setlist editor and the overlay's
   * own Prev/Next anchors should pass it — every other caller leaves it
   * undefined so that navigating home → song produces a context-free page.
   */
  song: (songSlug: string, opts?: { version?: number; setlist?: string; edit?: 'raw' }) =>
    `/music/song${slug(songSlug)}` +
    (opts?.version ? `&v=${opts.version}` : '') +
    (opts?.setlist ? `&setlist=${encodeURIComponent(opts.setlist)}` : '') +
    // A new blank song opens in Edit with Raw text open (songMode.ts).
    (opts?.edit ? `&edit=${opts.edit}` : ''),
  songRaw: (songSlug: string) => `/music/song${slug(songSlug)}&raw=true`,

  // ── Setlists ─────────────────────────────────────────────────────────────
  /** GET: setlist edit page. Renders an empty editor if the setlist doesn't exist yet. */
  setlist: (name: string) => `/music/setlist?name=${encodeURIComponent(name)}`,
  /** GET: JSON for one setlist. 404 when the setlist doesn't exist. */
  setlistData: (name: string) => `/music/setlist-data?name=${encodeURIComponent(name)}`,
  /** POST: upsert (and optional rename). Body: SaveSetlistRequest. */
  saveSetlist: '/music/save-setlist',
  /** DELETE: remove a setlist. */
  deleteSetlist: (name: string) => `/music/delete-setlist?name=${encodeURIComponent(name)}`,

  // ── JSON API: songs (CRUD) ──────────────────────────────────────────────
  /** POST: create a new song. Body: { songName, title?, content }. */
  createSong: '/music/songs',
  /** POST: replace an existing song's body. Body: { songName, content }. */
  saveChords: '/music/save-chords',
  /** DELETE: remove a song. Query: ?songName=... */
  deleteSong: (songSlug: string) => `/music/delete-song${slug(songSlug)}`,
  /** POST: change a song's display title. Body: { songName, newTitle }. */
  renameSong: '/music/rename-song',
  /** GET: array of all song slugs. */
  songList: '/music/song-list',
  /** POST: upload a song from JSON or form-encoded body. */
  uploadSong: '/music/upload-song',

  // ── JSON API: per-song metadata ─────────────────────────────────────────
  /** GET: full SongMeta for one song. Query: ?songName=... */
  songMeta: (songSlug: string) => `/music/song-meta${slug(songSlug)}`,
  /** GET: dump of every song's metadata. */
  exportSongMeta: '/music/export/song-meta',
  /** POST: merge a metadata blob into the store. */
  restoreSongMeta: '/music/restore/song-meta',
  /** POST: save tags. Body: { songName, tags }. */
  saveSongTags: '/music/save-song-tags',
  /** POST: the song's real key, as an offset from the detected one. Body: { songName, keyOffset }. */
  saveSongKey: '/music/save-song-key',
  /** GET: the tag set (groups, implies, auto). */
  tagConfig: '/music/tag-config',
  /** POST: save metronome settings. Body: { songName, bpm, timeSignature, key }. */
  saveMetronomeSettings: '/music/save-metronome-settings',
  /** POST: save YouTube widget settings. */
  saveYouTubeSettings: '/music/save-youtube-settings',

  // ── JSON API: external scrapers / search ────────────────────────────────
  /** POST: scrape a hopamchuan URL. Body: { url }. */
  proxy: '/music/proxy',
  /** GET: hopamchuan title search. Query: ?q=... */
  hopamchuanSearch: (q: string) => `/music/hopamchuan-search?q=${encodeURIComponent(q)}`,
  /** POST: import the highest-scoring version of a hopamchuan song. */
  hopamchuanImport: '/music/hopamchuan-import',
  /** GET: YouTube search via the server-side proxy. Query: ?q=... */
  youtubeSearch: (q: string) => `/music/youtube-search?q=${encodeURIComponent(q)}`,

  // ── Versions ────────────────────────────────────────────────────────────────
  /** GET: list all versions for a song. */
  songVersions: (songSlug: string) => `/music/song-versions${slug(songSlug)}`,
  /** POST: new version, cloned or from given content. Body: { songName, fromVersion, label?, content? }. */
  createVersion: '/music/create-version',
  /** DELETE: remove a non-default version. Query: ?songName=...&v=N. */
  deleteVersion: (songSlug: string, v: number) =>
    `/music/delete-version${slug(songSlug)}&v=${v}`,
  /** POST: update a version's custom label. Body: { songName, version, label }. */
  saveVersionLabel: '/music/save-version-label',

  // ── Audio download, upload & serving ────────────────────────────────────────
  /** POST: download audio from YouTube via yt-dlp. Body: { videoId, songName }. */
  downloadAudio: '/music/download-audio',
  /** POST: upload an MP3 file directly. Multipart: songName (text), audio (file). */
  uploadAudio: '/music/upload-audio',
  /** GET: serve an audio file by filename. Query: ?file=youtube/videoId_full.mp3 */
  audio: (filename: string) => `/music/audio?file=${encodeURIComponent(filename)}`,
  /** POST: start Demucs stem separation on the server. Body: { songName }. */
  separateStems: '/music/separate-stems',
  /** GET: stem separation status. Query: ?songName=... */
  stemStatus: (songSlug: string) => `/music/separate-stems${slug(songSlug)}`,

  // ── Guitar tab (.gp Guitar Pro files) ───────────────────────────────────────
  /** POST: upload a Guitar Pro file. Multipart: songName (text), tab (file). */
  uploadTab: '/music/upload-tab',
  /** GET: serve a Guitar Pro file by filename. Query: ?file=MyLove.gp */
  tab: (filename: string) => `/music/tab?file=${encodeURIComponent(filename)}`,
  /** POST: clear a song's tab association and delete the .gp file. Body: { songName }. */
  removeTab: '/music/remove-tab',
} as const;

/**
 * Routes that exist server-side but should NOT be called from production
 * frontend code. Listed here for completeness + so the contract spec can
 * verify they exist; importing from this is a code smell.
 */
export const TEST_ONLY_ROUTES = {
  /** POST: flushes Go singletons (only registered when CHORDEDIT_TEST_MODE=1). */
  reloadState: '/music/__test__/reload-state',
} as const;
