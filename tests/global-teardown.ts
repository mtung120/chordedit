import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Delete the built server binary after the run. Per-worker SONGS_DIR tmp
 * dirs are cleaned up by each worker's fixture teardown — nothing lingers
 * outside tests/.bin/.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const binDir = resolve(__dirname, '.bin');

export default async function globalTeardown() {
  try {
    rmSync(binDir, { recursive: true, force: true });
  } catch {
    // Non-fatal — binary might already be gone (CI artifact collection etc.)
  }
}
