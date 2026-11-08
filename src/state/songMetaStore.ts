/**
 * Per-song metadata store. One /song-meta fetch per page load, shared by the
 * metronome, tags, and YouTube widgets via get().
 */

import { getSongMeta } from '../api/client.js';
import type { SongMetaResponse } from '../api/types.js';

declare global {
  interface Window {
    songName?: string;
  }
}

let inflight: Promise<SongMetaResponse> | null = null;
let cached: SongMetaResponse | null = null;

const EMPTY: SongMetaResponse = {
  tags: [],
  youtubeVideoId: '',
  youtubeVideoTitle: '',
  audioSource: '',
  uploadedAudioName: '',
  fullMp3Audio: '',
  vocalAudio: '',
  instrumentAudio: '',
  versionLabels: {},
  guitarTab: '',
};

/**
 * Get the song's metadata. The first call kicks off a single fetch; later
 * calls await the same in-flight promise. Errors resolve to a default-shape
 * object so callers don't need null checks on `metronome` / `youtube` / `tags`.
 */
export async function get(): Promise<SongMetaResponse> {
  if (cached) return cached;
  if (inflight) return inflight;

  const slug = window.songName;
  if (!slug) {
    cached = EMPTY;
    return EMPTY;
  }

  inflight = (async () => {
    try {
      const meta = await getSongMeta(slug);
      cached = meta;
      return meta;
    } catch (err) {
      console.error('songMetaStore: fetch failed', err);
      cached = EMPTY;
      return EMPTY;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

// Mount: kick off the fetch immediately so widgets' get() calls share it.
function mount(): void {
  if (!window.songName) return;
  void get();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
  mount();
}
