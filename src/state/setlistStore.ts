/**
 * Per-setlist data store for the song-page Prev/Next overlay.
 *
 * On a song page reached via /music/song?songName=X&setlist=Y, the
 * setlistContext feature calls get(Y) once to fetch the setlist's ordered
 * song list, then renders Prev/Next anchors. The fetch is in-flight-deduped
 * so multiple callers on the same page share one request.
 *
 * Returns null on 404 or any fetch error — the overlay treats that as
 * "no setlist context" and renders nothing.
 */

import { getSetlistData } from '../api/client.js';
import type { Setlist } from '../api/types.js';

const inflight = new Map<string, Promise<Setlist | null>>();
const cached = new Map<string, Setlist | null>();

export async function get(name: string): Promise<Setlist | null> {
  if (cached.has(name)) return cached.get(name) ?? null;
  const existing = inflight.get(name);
  if (existing) return existing;

  const p = (async () => {
    try {
      const sl = await getSetlistData(name);
      cached.set(name, sl);
      return sl;
    } catch (err) {
      console.warn('setlistStore: fetch failed for', name, err);
      cached.set(name, null);
      return null;
    } finally {
      inflight.delete(name);
    }
  })();
  inflight.set(name, p);
  return p;
}

/** Invalidate the cached copy — used by the editor after a successful save. */
export function invalidate(name: string): void {
  cached.delete(name);
  inflight.delete(name);
}
