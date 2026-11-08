import { cp, readdir, rm, writeFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = resolve(__dirname, '..', 'fixtures');

/**
 * Copy the committed fixture songs + .song-meta.json into a target dir and
 * reset .access_times.json to empty so "Recently Played" order is
 * deterministic. Idempotent — safe to call before every test.
 *
 *   tests/fixtures/songs/*.txt  → <targetDir>/
 *   tests/fixtures/song-meta.json → <targetDir>/.song-meta.json
 *   empty .access_times.json     → <targetDir>/.access_times.json
 */
export async function seedSongsDir(targetDir: string): Promise<void> {
  // Wipe any prior state (but keep the dir itself so spawned Go process's
  // working reference stays valid).
  const entries = await readdir(targetDir).catch(() => [] as string[]);
  await Promise.all(
    entries.map((name) => rm(join(targetDir, name), { recursive: true, force: true })),
  );

  // Copy songs/*.txt
  const songsSrc = join(fixturesRoot, 'songs');
  const songFiles = await readdir(songsSrc);
  await Promise.all(
    songFiles.map((name) => cp(join(songsSrc, name), join(targetDir, name))),
  );

  // Copy .song-meta.json
  const metaJson = await readFile(join(fixturesRoot, 'song-meta.json'), 'utf8');
  await writeFile(join(targetDir, '.song-meta.json'), metaJson);

  // Start with empty access times so "Recently Played" is deterministic
  // per test (a test that wants specific recents should post-seed this
  // file directly after calling seed()).
  await writeFile(join(targetDir, '.access_times.json'), '{}');
}
