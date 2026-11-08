import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Build the Go binary once per test run. The per-worker server fixture
 * (tests/helpers/server.ts) spawns this binary with PORT + SONGS_DIR env vars,
 * so building once here avoids N parallel `go build` invocations.
 *
 * The binary lives at tests/.bin/chordedit so it's isolated from the dev
 * workflow (which uses `go run main.go`).
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const binDir = resolve(__dirname, '.bin');
export const serverBinary = resolve(binDir, 'chordedit');

export default async function globalSetup() {
  const result = spawnSync('go', ['build', '-o', serverBinary, '.'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`go build failed with status ${result.status}`);
  }
  if (!existsSync(serverBinary)) {
    throw new Error(`server binary missing at ${serverBinary}`);
  }
}
