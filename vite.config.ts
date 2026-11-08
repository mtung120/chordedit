import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * Vite config for ChordEdit's TypeScript frontend.
 *
 * - Four entry points (one per page) under src/entries/. Each one
 *   imports only the modules that page needs.
 * - Output goes to static/dist/ with content-hashed filenames; Vite
 *   emits a manifest.json so the Go server can map "home" → the
 *   right hashed bundle (see handlers/vite.go).
 * - Dev server runs on :5173 and proxies /music + /static to the Go
 *   server on :8080. Templates referenced via {{vite "..."}} resolve
 *   to dev URLs in dev mode and hashed files in build mode.
 *
 */
export default defineConfig({
  // Vite serves assets from this base. The Go server mounts /static/dist/
  // at the same path so production URLs match dev URLs.
  base: '/static/dist/',

  build: {
    outDir: resolve(__dirname, 'static/dist'),
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      input: {
        home: resolve(__dirname, 'src/entries/home.ts'),
        song: resolve(__dirname, 'src/entries/song.ts'),
        setlist: resolve(__dirname, 'src/entries/setlist.ts'),
      },
    },
    // Sourcemaps in dev for debuggability; off in prod so we don't ship
    // readable source maps next to the minified bundles.
    sourcemap: process.env.NODE_ENV !== 'production',
  },

  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // Everything not under /static/dist/ comes from the Go backend.
      '/music': 'http://localhost:8080',
      '/static': 'http://localhost:8080',
    },
  },

  test: {
    // Vitest config lives here so it shares Vite's resolver. Unit tests
    // are *.test.ts under src/. Playwright E2E lives in tests/ and uses
    // its own runner — totally separate.
    include: ['src/**/*.test.ts'],
    environment: 'jsdom',
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/entries/**'],
    },
  },
});
