/**
 * TypeScript shapes for the ChordEdit JSON API.
 *
 * Each interface mirrors a Go struct in handlers/. The Go side is the
 * source of truth; types here are kept in sync via:
 *   1. Manual review when adding new endpoints
 *   2. handlers/api_drift_test.go — a Go test that JSON-marshals every
 *      response struct and compares the field set against a committed
 *      schema snapshot (src/api/schema.json). Drift fails CI.
 *
 * Conventions:
 * - Field names match the JSON tag (camelCase) — NOT the Go field name.
 * - Optional fields use `field?: T` (Go's `omitempty` + zero-able types).
 * - Pointer fields in Go (e.g. `*MetronomeSettings`) become `field?: T`.
 */

// ─── Per-song metadata ──────────────────────────────────────────────────────

/** handlers/metronome.go: MetronomeSettings */
export interface MetronomeSettings {
  bpm: number;
  timeSignature: string;
  /** Audio offset in seconds for syncing the metronome click to the recording. */
  beatAnchor?: number;
  /** Clicks nudged earlier (<0) / later (>0) than beatAnchor, ms (±500). */
  offsetMs?: number;
}

/**
 * handlers/song_meta.go: SongMeta — persisted per-song metadata.
 * The wire format flattens audio-source fields (no nested objects).
 */
export interface SongMeta {
  title?: string;
  tags?: string[];
  metronome?: MetronomeSettings;
  youtubeVideoId?: string;
  youtubeVideoTitle?: string;
  /** "youtube" | "upload" | "" */
  audioSource?: string;
  uploadedAudioId?: string;
  uploadedAudioName?: string;
  /** Map: version number (as string) → custom label. */
  versionLabels?: Record<string, string>;
  /** Filename of the attached Guitar Pro file (in SongsDir). Empty if no tab. */
  guitarTab?: string;
  /** Semitones from the detected key to the song's real key (1–11; absent = 0). */
  keyOffset?: number;
}

/**
 * GetSongMetaHandler hydrates derived audio fields (resolved against disk)
 * before responding. Tags / metronome are always present; audio fields are
 * always present (possibly empty strings).
 */
export interface SongMetaResponse {
  title?: string;
  tags: string[];
  metronome?: MetronomeSettings;
  youtubeVideoId: string;
  youtubeVideoTitle: string;
  /** "youtube" | "upload" | "" */
  audioSource: string;
  uploadedAudioName: string;
  /** URL of the merged full-mix MP3 (server-derived). Empty if not present. */
  fullMp3Audio: string;
  /** URL of the vocal stem (server-derived). Empty if not present. */
  vocalAudio: string;
  /** URL of the instrument stem (server-derived). Empty if not present. */
  instrumentAudio: string;
  versionLabels: Record<string, string>;
  /** Filename of the attached Guitar Pro file. Empty string if no tab. */
  guitarTab: string;
}

// ─── Home page (data injected via template, not fetched) ────────────────────

/** handlers/home.go: SongInfo — used in window.songData / window.recentSongs. */
export interface SongInfo {
  /** Slug — filename without .txt. */
  name: string;
  /** Display title; falls back to the slug if no metadata title is set. */
  title: string;
  /** Set by the user. */
  tags: string[];
  /** Derived from the song's audio files on disk ("Audio", "Stems"). */
  autoTags: string[];
  /** From hopamchuan.com; shown and filtered on the home page only. */
  artists: string[];
}

// ─── Songs CRUD ─────────────────────────────────────────────────────────────

/** POST /music/save-chords — body. */
export interface SaveChordsRequest {
  songName: string;
  content: string;
  /** 0 = default song body, 1+ = version N. */
  version?: number;
}

/** POST /music/songs — body (handlers/home.go: PostSong). */
export interface CreateSongRequest {
  /** Slug. The server runs sanitizeFileName on this — see app docs. */
  songName: string;
  /** Display title; optional. Falls back to the slug. */
  title?: string;
  content: string;
  /** Artists from hopamchuan.com; optional. */
  artists?: string[];
}
/** Response is plain text — the sanitised slug. No JSON wrapper. */
export type CreateSongResponse = string;

/** POST /music/rename-song — body. */
export interface RenameSongRequest {
  songName: string;
  /** Max 200 chars (server-enforced). */
  newTitle: string;
}

/** POST /music/upload-song — body (also accepts form-urlencoded shape). */
export interface UploadSongRequest {
  songName: string;
  content: string;
}

/** POST /music/upload-song — response. */
export interface UploadSongResponse {
  success: boolean;
  message: string;
  songName: string;
  filePath: string;
}

/** GET /music/song-list — response. */
export type SongListResponse = string[];

// ─── Versions ───────────────────────────────────────────────────────────────

/** handlers/song.go: SongVersionInfo — one entry in the version list. */
export interface SongVersionInfo {
  /** 0 = default song body, 1+ = explicit version. */
  version: number;
  label: string;
}

/** GET /music/song-versions?songName=X — response. */
export interface SongVersionsResponse {
  versions: SongVersionInfo[];
}

/** POST /music/create-version — body. */
export interface CreateVersionRequest {
  songName: string;
  /** Source version to clone content from. 0 = default body. */
  fromVersion: number;
  /** Optional custom label for the new version. */
  label?: string;
  /** The new version's body instead of a clone (fromVersion is then ignored). */
  content?: string;
}

/** POST /music/create-version — response. */
export interface CreateVersionResponse {
  /** The new version number that was created (>=1). */
  version: number;
}

/** POST /music/save-version-label — body. */
export interface SaveVersionLabelRequest {
  songName: string;
  /** Version number (>=1; version 0 is "Original" and not customizable). */
  version: number;
  /** Empty string clears the custom label, falling back to "Version N". */
  label: string;
}

// ─── Tags ───────────────────────────────────────────────────────────────────

/** POST /music/save-song-tags — body. */
export interface SaveSongTagsRequest {
  songName: string;
  /** Server rejects tags outside TagConfig.groups, and more tags than groups. */
  tags: string[];
}

/** POST /music/save-song-key — body (handlers/song_meta.go). */
export interface SaveSongKeyRequest {
  songName: string;
  /** Semitones from the key detected from the chords to the real one, 0–11; 0 clears it. */
  keyOffset: number;
}

/** handlers/tags.go: TagConfig — GET /music/tag-config, window.tagConfig. */
export interface TagConfig {
  /** Tags users can apply; tags in the same group exclude each other. */
  groups: string[][];
  /** A song tagged with a key also matches the filters for its values. */
  implies: Record<string, string[]>;
  /** Tags derived from disk, shown and filtered but never edited. */
  auto: string[];
}

// ─── Metronome ──────────────────────────────────────────────────────────────

/** POST /music/save-metronome-settings — body. */
export interface SaveMetronomeSettingsRequest {
  songName: string;
  /** 20–300 inclusive (server-enforced). */
  bpm: number;
  /** Allowlist: 2/4 3/4 4/4 5/4 6/8 12/8. */
  timeSignature: string;
  /** Audio offset in seconds. */
  beatAnchor?: number;
  /** −500…500 (server-enforced). */
  offsetMs?: number;
}

// ─── YouTube ────────────────────────────────────────────────────────────────

/** handlers/youtube.go: YouTubeSearchResult — one video. */
export interface YouTubeSearchResultItem {
  videoId: string;
  title: string;
  channel: string;
  thumbnail: string;
}

/** GET /music/youtube-search?q=... — response. */
export type YouTubeSearchResponse = YouTubeSearchResultItem[];

/** POST /music/save-youtube-settings — body. */
export interface SaveYouTubeSettingsRequest {
  songName: string;
  videoId: string;
  title: string;
}

// ─── Audio upload ───────────────────────────────────────────────────────────

/** POST /music/upload-audio — multipart response (handlers/audio.go: uploadAudioResponse). */
export interface UploadAudioResponse {
  status: string;
  audioId: string;
}

/** POST /music/upload-tab — multipart response (handlers/tab.go: uploadTabResponse). */
export interface UploadTabResponse {
  status: string;
  /** Stored filename of the .gp file (basename in SongsDir). */
  tab: string;
}

// ─── External proxies / scrapers ────────────────────────────────────────────

/** POST /music/proxy — body. */
export interface ProxyRequest {
  url: string;
}

/** POST /music/proxy — response. */
export interface ProxyResponse {
  content: string;
}

/** handlers/proxy.go: HacSearchResult. */
export interface HopamchuanSearchResult {
  id: string;
  slug: string;
  title: string;
  artists: string[];
}
/** GET /music/hopamchuan-search?q=... — response. */
export type HopamchuanSearchResponse = HopamchuanSearchResult[];

/** POST /music/hopamchuan-import — body. */
export interface HopamchuanImportRequest {
  songId: string;
  slug: string;
}

/**
 * One scored chord-sheet variant returned by /music/hopamchuan-import
 * (handlers/proxy.go: HacImportVersion). The user picks among up to 4 of
 * these in the home page's add-song preview.
 */
export interface HopamchuanImportVersion {
  url: string;
  /**
   * Human-readable version label scraped from the hopamchuan listing
   * (e.g. "theo phiên bản của Hiển Râu", "Phiên bản chuẩn"). May be empty
   * for the fallback base URL.
   */
  label: string;
  /** Chord-complexity score (slash chords + extensions weighted highest). */
  score: number;
  /**
   * True for the version hopamchuan marks "Bản chính". The server pins this
   * to position 0 regardless of score so the user's first option is always
   * the canonical version.
   */
  isDefault: boolean;
  /** Fully-rendered chord sheet with inline `[Chord]` markers. */
  content: string;
}

/**
 * POST /music/hopamchuan-import — response (handlers/proxy.go:
 * HacImportResponse). Always non-empty on a 200; on total fetch failure the
 * server replies 502.
 */
export interface HopamchuanImportResponse {
  versions: HopamchuanImportVersion[];
}

// ─── Audio download ─────────────────────────────────────────────────────────

/** POST /music/download-audio — body. */
export interface DownloadAudioRequest {
  videoId: string;
  songName: string;
}

/** POST /music/download-audio — response. */
export interface DownloadAudioResponse {
  status: 'ready' | 'downloading' | 'error';
  url?: string;
  error?: string;
}

/** POST /music/separate-stems — body. */
export interface SeparateStemsRequest {
  songName: string;
}

/** GET/POST /music/separate-stems — response (handlers/stems.go). */
export interface SeparateStemsResponse {
  status: 'none' | 'separating' | 'ready' | 'error';
  error?: string;
}

// ─── Metadata import/export ─────────────────────────────────────────────────

/**
 * GET /music/export/song-meta — returns the entire metadata file. Keys are
 * song slugs.
 */
export type ExportSongMetaResponse = Record<string, SongMeta>;

/** POST /music/restore/song-meta — body. */
export type RestoreSongMetaRequest = Record<string, SongMeta>;

// ─── Setlists ───────────────────────────────────────────────────────────────

/**
 * handlers/setlist.go: Setlist — a named, ordered collection of songs.
 * Songs is an array of song slugs (filenames without .txt).
 */
export interface Setlist {
  name: string;
  songs: string[];
}

/**
 * POST /music/save-setlist — body. Upserts at `name`. If `oldName` is
 * non-empty and differs from `name`, the old setlist is deleted as part
 * of the same atomic write (rename).
 */
export interface SaveSetlistRequest {
  oldName?: string;
  name: string;
  songs: string[];
}
