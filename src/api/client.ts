/**
 * Typed fetch wrappers around the ChordEdit JSON API.
 *
 * Use these instead of raw fetch() so that:
 * - Request/response types are checked at the call site (TypeScript will
 *   reject a body shape that doesn't match the endpoint's interface).
 * - Error handling is consistent: 4xx / 5xx becomes a typed `ApiError`,
 *   network failures become `NetworkError`, JSON parse failures become
 *   `ResponseShapeError`. Callers `try/catch` on `ApiError` if they want
 *   to render a server message; otherwise the error bubbles up uncaught
 *   and lands in the global error handler.
 * - URLs come from src/routes.ts (single source of truth).
 *
 * Per-endpoint convenience functions live at the bottom of this file —
 * they collapse "import ROUTES; build body; call apiPost" into a single
 * named call.
 */

import { ROUTES } from '../routes.js';
import type {
  CreateSongRequest,
  CreateSongResponse,
  CreateVersionRequest,
  CreateVersionResponse,
  DownloadAudioRequest,
  DownloadAudioResponse,
  SeparateStemsRequest,
  SeparateStemsResponse,
  ExportSongMetaResponse,
  HopamchuanImportRequest,
  HopamchuanImportResponse,
  HopamchuanSearchResponse,
  ProxyRequest,
  ProxyResponse,
  RenameSongRequest,
  RestoreSongMetaRequest,
  SaveChordsRequest,
  SaveMetronomeSettingsRequest,
  SaveSetlistRequest,
  SaveSongKeyRequest,
  SaveSongTagsRequest,
  SaveVersionLabelRequest,
  SaveYouTubeSettingsRequest,
  Setlist,
  SongListResponse,
  SongMetaResponse,
  SongVersionsResponse,
  TagConfig,
  UploadAudioResponse,
  UploadSongRequest,
  UploadSongResponse,
  UploadTabResponse,
  YouTubeSearchResponse,
} from './types.js';

// ─── Error types ────────────────────────────────────────────────────────────

/**
 * Server returned a non-2xx status. `body` holds the response body if the
 * server sent one (server typically returns plain text via http.Error).
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
  ) {
    super(`API ${status} from ${url}: ${body}`);
    this.name = 'ApiError';
  }
}

/** fetch() rejected (network down, CORS, etc.). */
export class NetworkError extends Error {
  constructor(readonly url: string, readonly cause: unknown) {
    super(`Network error reaching ${url}: ${cause instanceof Error ? cause.message : cause}`);
    this.name = 'NetworkError';
  }
}

/** Server replied 2xx but the body wasn't the expected JSON shape. */
export class ResponseShapeError extends Error {
  constructor(readonly url: string, readonly cause: unknown) {
    super(`Bad response from ${url}: ${cause instanceof Error ? cause.message : cause}`);
    this.name = 'ResponseShapeError';
  }
}

// ─── Generic verbs ──────────────────────────────────────────────────────────

async function rawFetch(url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new NetworkError(url, err);
  }
  if (!res.ok) {
    let body = '';
    try {
      body = await res.text();
    } catch {
      // ignore — we'd rather report the original status
    }
    throw new ApiError(res.status, url, body.trim());
  }
  return res;
}

/** GET → JSON. The response is validated only at the type level. */
export async function apiGet<Resp>(url: string): Promise<Resp> {
  const res = await rawFetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  try {
    return (await res.json()) as Resp;
  } catch (err) {
    throw new ResponseShapeError(url, err);
  }
}

/** GET → plain text (used by /music/songs POST whose response is the slug). */
export async function apiGetText(url: string): Promise<string> {
  const res = await rawFetch(url, { method: 'GET' });
  return res.text();
}

/** POST JSON, return JSON. */
export async function apiPost<Req, Resp>(url: string, body: Req): Promise<Resp> {
  const res = await rawFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  try {
    return (await res.json()) as Resp;
  } catch (err) {
    throw new ResponseShapeError(url, err);
  }
}

/** POST JSON, expect plain text back. */
export async function apiPostText<Req>(url: string, body: Req): Promise<string> {
  const res = await rawFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.text();
}

/** POST JSON, expect 2xx empty (or text we ignore). */
export async function apiPostVoid<Req>(url: string, body: Req): Promise<void> {
  await rawFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** DELETE, expect 2xx empty. */
export async function apiDelete(url: string): Promise<void> {
  await rawFetch(url, { method: 'DELETE' });
}

// ─── Per-endpoint convenience wrappers ──────────────────────────────────────
// These centralise URL + payload construction. Modules that talk to the
// server import these (not the verbs) so the call site reads as English:
//   `await saveSongTags({ songName, tags })` instead of
//   `await apiPostVoid<SaveSongTagsRequest>(ROUTES.saveSongTags, {...})`.

export const getSongList = (): Promise<SongListResponse> =>
  apiGet<SongListResponse>(ROUTES.songList);

export const getSongMeta = (slug: string): Promise<SongMetaResponse> =>
  apiGet<SongMetaResponse>(ROUTES.songMeta(slug));

export const getTagConfig = (): Promise<TagConfig> =>
  apiGet<TagConfig>(ROUTES.tagConfig);

export const exportSongMeta = (): Promise<ExportSongMetaResponse> =>
  apiGet<ExportSongMetaResponse>(ROUTES.exportSongMeta);

export const youtubeSearch = (q: string): Promise<YouTubeSearchResponse> =>
  apiGet<YouTubeSearchResponse>(ROUTES.youtubeSearch(q));

export const hopamchuanSearch = (q: string): Promise<HopamchuanSearchResponse> =>
  apiGet<HopamchuanSearchResponse>(ROUTES.hopamchuanSearch(q));

export const saveChords = (req: SaveChordsRequest): Promise<void> =>
  apiPostVoid(ROUTES.saveChords, req);

export const renameSong = (req: RenameSongRequest): Promise<void> =>
  apiPostVoid(ROUTES.renameSong, req);

export const saveSongTags = (req: SaveSongTagsRequest): Promise<void> =>
  apiPostVoid(ROUTES.saveSongTags, req);

export const saveSongKey = (req: SaveSongKeyRequest): Promise<void> =>
  apiPostVoid(ROUTES.saveSongKey, req);

export const saveMetronomeSettings = (req: SaveMetronomeSettingsRequest): Promise<void> =>
  apiPostVoid(ROUTES.saveMetronomeSettings, req);


export const saveYouTubeSettings = (req: SaveYouTubeSettingsRequest): Promise<void> =>
  apiPostVoid(ROUTES.saveYouTubeSettings, req);

export const restoreSongMeta = (req: RestoreSongMetaRequest): Promise<void> =>
  apiPostVoid(ROUTES.restoreSongMeta, req);

export const proxy = (req: ProxyRequest): Promise<ProxyResponse> =>
  apiPost<ProxyRequest, ProxyResponse>(ROUTES.proxy, req);

export const hopamchuanImport = (
  req: HopamchuanImportRequest,
): Promise<HopamchuanImportResponse> =>
  apiPost<HopamchuanImportRequest, HopamchuanImportResponse>(ROUTES.hopamchuanImport, req);

export const createSong = (req: CreateSongRequest): Promise<CreateSongResponse> =>
  apiPostText(ROUTES.createSong, req);

export const uploadSong = (req: UploadSongRequest): Promise<UploadSongResponse> =>
  apiPost<UploadSongRequest, UploadSongResponse>(ROUTES.uploadSong, req);

export const deleteSong = (slug: string): Promise<void> =>
  apiDelete(ROUTES.deleteSong(slug));

export const downloadAudio = (req: DownloadAudioRequest): Promise<DownloadAudioResponse> =>
  apiPost<DownloadAudioRequest, DownloadAudioResponse>(ROUTES.downloadAudio, req);

export const separateStems = (songName: string): Promise<SeparateStemsResponse> =>
  apiPost<SeparateStemsRequest, SeparateStemsResponse>(ROUTES.separateStems, { songName });

export const getStemStatus = (songName: string): Promise<SeparateStemsResponse> =>
  apiGet<SeparateStemsResponse>(ROUTES.stemStatus(songName));

export const getSongVersions = (slug: string): Promise<SongVersionsResponse> =>
  apiGet<SongVersionsResponse>(ROUTES.songVersions(slug));

export const createVersion = (
  req: CreateVersionRequest,
): Promise<CreateVersionResponse> =>
  apiPost<CreateVersionRequest, CreateVersionResponse>(ROUTES.createVersion, req);

export const deleteVersion = (slug: string, v: number): Promise<void> =>
  apiDelete(ROUTES.deleteVersion(slug, v));

export const saveVersionLabel = (req: SaveVersionLabelRequest): Promise<void> =>
  apiPostVoid(ROUTES.saveVersionLabel, req);

export async function uploadAudio(songName: string, file: File): Promise<UploadAudioResponse> {
  const form = new FormData();
  form.append('songName', songName);
  form.append('audio', file);
  const res = await rawFetch(ROUTES.uploadAudio, { method: 'POST', body: form });
  try {
    return (await res.json()) as UploadAudioResponse;
  } catch (err) {
    throw new ResponseShapeError(ROUTES.uploadAudio, err);
  }
}

export async function uploadTab(songName: string, file: File): Promise<UploadTabResponse> {
  const form = new FormData();
  form.append('songName', songName);
  form.append('tab', file);
  const res = await rawFetch(ROUTES.uploadTab, { method: 'POST', body: form });
  try {
    return (await res.json()) as UploadTabResponse;
  } catch (err) {
    throw new ResponseShapeError(ROUTES.uploadTab, err);
  }
}

export const removeTab = (songName: string): Promise<void> =>
  apiPostVoid(ROUTES.removeTab, { songName });

// ─── Setlists ─────────────────────────────────────────────────────────────

export const getSetlistData = (name: string): Promise<Setlist> =>
  apiGet<Setlist>(ROUTES.setlistData(name));

export const saveSetlist = (req: SaveSetlistRequest): Promise<void> =>
  apiPostVoid(ROUTES.saveSetlist, req);

export const deleteSetlist = (name: string): Promise<void> =>
  apiDelete(ROUTES.deleteSetlist(name));
