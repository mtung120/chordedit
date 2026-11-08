import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test as base, type TestInfo } from '@playwright/test';

import { seedSongsDir } from './seed.js';
import { installNetworkStubs, installVisualDeterminism } from './visual.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const serverBinary = resolve(__dirname, '..', '.bin', 'chordedit');

/**
 * Ask the kernel for a free TCP port by binding to 0 and reading back what
 * we got. There's a small race between close() and the Go server binding,
 * but parallel workers get distinct ports so collisions are unlikely. We
 * retry once on EADDRINUSE below.
 */
async function getFreePort(): Promise<number> {
  return await new Promise((resolvePort, rejectPort) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', rejectPort);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (typeof addr !== 'object' || !addr) {
        srv.close();
        rejectPort(new Error('no address'));
        return;
      }
      const port = addr.port;
      srv.close(() => resolvePort(port));
    });
  });
}

async function waitForReady(baseURL: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseURL}/music/songs`, { redirect: 'manual' });
      if (res.status === 200) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(
    `Go server at ${baseURL} never came up: ${lastErr instanceof Error ? lastErr.message : lastErr}`,
  );
}

type ServerHandle = {
  baseURL: string;
  songsDir: string;
  proc: ChildProcess;
};

async function startServer(): Promise<ServerHandle> {
  const songsDir = await mkdtemp(join(tmpdir(), 'chordedit-test-'));
  // seedSongsDir is also called per-test below (see `seed` fixture) so each
  // test starts from a clean fixture set. The initial seed here guards
  // against a test forgetting to call `seed`.
  await seedSongsDir(songsDir);

  // Retry once if the port we picked got snatched between getFreePort and
  // the Go bind.
  for (let attempt = 0; attempt < 2; attempt++) {
    const port = await getFreePort();
    const proc = spawn(serverBinary, [], {
      cwd: repoRoot,
      env: {
        ...process.env,
        PORT: String(port),
        SONGS_DIR: songsDir,
        // Disable YouTube API so the search endpoint returns 503 deterministically;
        // tests that need it install stubs at the network level.
        YOUTUBE_API_KEY: '',
        // Enables /music/__test__/reload-state, used by seedAuto to flush
        // in-memory singletons between tests so they reload the on-disk seed.
        // Production NEVER sets this.
        CHORDEDIT_TEST_MODE: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Capture stderr in case the port collides.
    let stderr = '';
    proc.stderr?.on('data', (buf: Buffer) => {
      stderr += buf.toString();
    });

    const baseURL = `http://127.0.0.1:${port}`;
    try {
      await waitForReady(baseURL);
      return { baseURL, songsDir, proc };
    } catch (err) {
      proc.kill('SIGKILL');
      if (attempt === 1) {
        await rm(songsDir, { recursive: true, force: true });
        throw new Error(`Server failed to start. stderr:\n${stderr}\n${err}`);
      }
      // Fall through and retry.
    }
  }
  throw new Error('unreachable');
}

async function stopServer(handle: ServerHandle): Promise<void> {
  handle.proc.kill('SIGTERM');
  // Force-kill if SIGTERM didn't take.
  setTimeout(() => {
    if (!handle.proc.killed) handle.proc.kill('SIGKILL');
  }, 500).unref();
  await rm(handle.songsDir, { recursive: true, force: true });
}

/**
 * Shape exposed to tests via the `test` export below.
 *
 *   test('foo', async ({ page, baseURL, songsDir }) => { ... });
 *
 * - `baseURL` is already used by Playwright (page.goto('/x') resolves against it).
 * - `songsDir` lets a test inspect / pre-seed / reset fixture state on disk.
 * - `seed` resets the songs dir to the canonical fixture set (per test).
 */
type TestFixtures = {
  /**
   * Auto-runs before every test, wiping SONGS_DIR back to the canonical
   * fixture set. This means a test can freely add/remove songs on disk
   * without affecting its neighbours in the same worker. Opt out by
   * declaring `seed: ...` to a no-op in a `test.use()` override if a
   * particular spec genuinely needs cross-test state (none do today).
   */
  seedAuto: void;
  seed: () => Promise<void>;
  // Override Playwright's built-in test-scoped baseURL so page.goto('/x')
  // resolves against our per-worker server. We can't declare baseURL at
  // worker scope because Playwright already reserves it at test scope.
  baseURL: string;
  songsDir: string;
};
type WorkerFixtures = {
  _serverHandle: ServerHandle;
};

export const test = base.extend<TestFixtures, WorkerFixtures>({
  _serverHandle: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const handle = await startServer();
      await use(handle);
      await stopServer(handle);
    },
    { scope: 'worker' },
  ],

  baseURL: async ({ _serverHandle }, use) => {
    await use(_serverHandle.baseURL);
  },

  songsDir: async ({ _serverHandle }, use) => {
    await use(_serverHandle.songsDir);
  },

  seed: async ({ songsDir }, use) => {
    await use(async () => seedSongsDir(songsDir));
  },

  seedAuto: [
    async ({ songsDir, baseURL }, use) => {
      await seedSongsDir(songsDir);
      // Tell the server to drop its singletons' in-memory caches and reload
      // from disk. Without this, state leaks across tests within a worker
      // even though disk gets reset (the AccessTracker / SongMetaStore
      // singletons cache state in memory).
      try {
        await fetch(`${baseURL}/music/__test__/reload-state`, { method: 'POST' });
      } catch {
        // First-test-in-worker case: the server may already be coming up.
        // The fixture's startServer() already waited for /music/songs to
        // return 200, so this should be rare.
      }
      await use();
    },
    { auto: true },
  ],

  // Every test gets network stubs + animation-disabling CSS by default.
  // Individual tests can override via page.route() for special cases.
  page: async ({ page }, use, testInfo: TestInfo) => {
    await installNetworkStubs(page);
    await installVisualDeterminism(page);
    await use(page);
    // Attach debug-friendly info on failure.
    if (testInfo.status !== testInfo.expectedStatus) {
      const url = page.url();
      if (url !== 'about:blank') testInfo.attach('final-url', { body: url });
    }
  },
});

export { expect } from '@playwright/test';
