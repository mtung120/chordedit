import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for ChordEdit E2E + visual regression.
 *
 * Design notes:
 * - Each worker spawns its own Go subprocess on a free port with an isolated
 *   SONGS_DIR. See tests/helpers/server.ts for the per-worker fixture.
 * - Visual tests are tagged @visual and run in a single dedicated project
 *   (Chromium + 4 viewports) so screenshot baselines are stable.
 * - Functional tests run Chromium-only (it's 99% of what catches bugs).
 * - All tests default to deny external network; helpers/network.ts installs
 *   stubs for hopamchuan.com and YouTube.
 */
export default defineConfig({
  testDir: '.',
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',

  /* Flake gate: 0 retries in dev, 2 in CI. */
  retries: process.env.CI ? 2 : 0,

  /* Run tests in parallel. Each worker gets its own Go server. */
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,

  /* Fail the test run if test.only is committed. */
  forbidOnly: !!process.env.CI,

  reporter: process.env.CI ? 'github' : [['list'], ['html', { open: 'never' }]],

  timeout: 30_000,
  expect: {
    timeout: 5_000,
    toHaveScreenshot: {
      /* Allow 1% of pixels to differ — absorbs font subpixel rounding.
       * Raise only if proven necessary; lower is better. */
      maxDiffPixelRatio: 0.01,
      /* Don't animate during screenshot; visual.ts also kills CSS animations. */
      animations: 'disabled',
      /* Ignore text-antialiasing differences between OS. */
      scale: 'device',
    },
  },

  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    /* Default viewport is replaced per-project below. */
  },

  /* Projects: one for functional (desktop-only), four for visual across all
   * target viewports. Each can be run individually via --project=name. */
  projects: [
    {
      name: 'functional',
      testMatch: /.*\.spec\.ts$/,
      testIgnore: /\.visual\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: 'visual-mobile',
      testMatch: /.*\.visual\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'], // same Chromium build, viewport overridden
        viewport: { width: 375, height: 812 },
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
          'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      },
    },
    {
      name: 'visual-tablet',
      testMatch: /.*\.visual\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 768, height: 1024 },
      },
    },
    {
      name: 'visual-laptop',
      testMatch: /.*\.visual\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: 'visual-desktop',
      testMatch: /.*\.visual\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
      },
    },
  ],
});
