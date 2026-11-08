import { test, expect } from '../helpers/server.js';
import type { Page } from '@playwright/test';
import { SongViewPage } from '../helpers/pages/songView.js';
import { openPractice, stubAudioReady } from '../helpers/media.js';

/**
 * Metronome (src/features/videoPlayer: the panel's chip + switch, and the
 * sheet in metronomeSheet.ts). Only shown once audio is ready. Fixture
 * `ConMuaNho` has metronome { bpm: 72, timeSignature: "4/4" } and no
 * beatAnchor, so it isn't set up yet ("Set up").
 */

/** Patch the /music/song-meta response for ConMuaNho (e.g. add a beatAnchor). */
async function patchSongMeta(page: Page, patch: Record<string, unknown>): Promise<void> {
  await page.route('**/music/song-meta?songName=ConMuaNho', async (route) => {
    const res = await route.fetch();
    const body = { ...(await res.json()), ...patch };
    await route.fulfill({ response: res, json: body });
  });
}

async function openMetronome(page: Page): Promise<SongViewPage> {
  await stubAudioReady(page);
  const sv = new SongViewPage(page);
  await sv.goto('ConMuaNho');
  await openPractice(sv);
  await expect(sv.practicePanel.locator('.metronome-chip')).toBeVisible();
  return sv;
}

const saveRequest = (page: Page) =>
  page.waitForRequest((r) => r.url().includes('/music/save-metronome-settings') && r.method() === 'POST');

const SET_UP = { metronome: { bpm: 72, timeSignature: '4/4', beatAnchor: 0.5 } };

test.describe('song view — metronome', () => {
  test('not set up: "Set up" opens the setup sheet; Escape closes it', async ({ page }) => {
    const sv = await openMetronome(page);
    const chip = sv.practicePanel.locator('.metronome-chip');
    await expect(chip).toHaveText('Set up');
    await expect(sv.practicePanel.locator('.metronome-toggle')).toBeHidden();

    await chip.click();
    const sheet = page.getByRole('dialog', { name: 'Set up the metronome' });
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('.metro-step')).toHaveText([
      /Play the song/,
      /Tap the pad on every beat/,
      /End on a “1”/,
    ]);
    // Paused: the pad plays the song first.
    await expect(sheet.locator('.metro-pad')).toContainText('Tap to play the song');
    await expect(sheet.getByRole('switch')).toBeHidden();
    await expect(sheet.getByRole('button', { name: '4/4' })).toHaveClass(/active/);

    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(chip).toBeFocused();
  });

  test('set up: the chip shows the tempo, the switch turns clicks on and off', async ({ page }) => {
    await patchSongMeta(page, SET_UP);
    const sv = await openMetronome(page);
    await expect(sv.practicePanel.locator('.metronome-chip')).toHaveText('72 BPM · 4/4');
    const toggle = sv.practicePanel.locator('.metronome-toggle');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  test('set up: BPM − / +, the 10 ms nudge and beats per bar save; Tap again re-opens setup', async ({ page }) => {
    await patchSongMeta(page, SET_UP);
    const sv = await openMetronome(page);
    await sv.practicePanel.locator('.metronome-chip').click();
    const sheet = page.getByRole('dialog', { name: 'Metronome' });
    await expect(sheet.locator('.metro-bpm-value')).toHaveText('72');
    await expect(sheet.locator('.metro-offset')).toHaveText('0 ms');

    let reqP = saveRequest(page);
    await sheet.getByRole('button', { name: 'Faster by 1 BPM' }).click();
    await sheet.getByRole('button', { name: 'Clicks 10 ms later' }).click();
    await sheet.getByRole('button', { name: 'Clicks 10 ms later' }).click();
    await expect(sheet.locator('.metro-bpm-value')).toHaveText('73');
    await expect(sheet.locator('.metro-offset')).toHaveText('+20 ms');
    expect(JSON.parse((await reqP).postData() ?? '{}')).toEqual({
      songName: 'ConMuaNho', bpm: 73, timeSignature: '4/4', beatAnchor: 0.5, offsetMs: 20,
    });
    await expect(sv.practicePanel.locator('.metronome-chip')).toHaveText('73 BPM · 4/4');

    reqP = saveRequest(page);
    await sheet.getByRole('button', { name: '6/8' }).click();
    await expect(sheet.locator('.metro-beat')).toHaveCount(6);
    expect(JSON.parse((await reqP).postData() ?? '{}').timeSignature).toBe('6/8');

    await sheet.getByRole('button', { name: 'Tap again' }).click();
    await expect(page.getByRole('dialog', { name: 'Set up the metronome' })).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.locator('.metro-overlay')).toBeHidden();
  });

  test('a saved nudge shows in the sheet', async ({ page }) => {
    await patchSongMeta(page, { metronome: { ...SET_UP.metronome, offsetMs: -30 } });
    const sv = await openMetronome(page);
    await sv.practicePanel.locator('.metronome-chip').click();
    await expect(page.locator('.metro-offset')).toHaveText('-30 ms');
  });
});

test.describe('metronome — server contract', () => {
  const post = (request: import('@playwright/test').APIRequestContext, baseURL: string | undefined, data: object) =>
    request.post(`${baseURL}/music/save-metronome-settings`, { data });

  test('accepts a valid body', async ({ request, baseURL }) => {
    const res = await post(request, baseURL, {
      songName: 'simple-ballad', bpm: 100, timeSignature: '3/4', beatAnchor: 1.25,
    });
    expect(res.status()).toBe(200);
  });

  test('rejects an invalid time signature', async ({ request, baseURL }) => {
    const res = await post(request, baseURL, { songName: 'simple-ballad', bpm: 120, timeSignature: '99/99' });
    expect(res.status()).toBe(400);
  });

  test('rejects BPM outside [20, 300]', async ({ request, baseURL }) => {
    for (const bpm of [19, 301, -5, 0]) {
      const res = await post(request, baseURL, { songName: 'simple-ballad', bpm, timeSignature: '4/4' });
      expect(res.status(), `bpm=${bpm}`).toBe(400);
    }
  });

  test('rejects a negative beat anchor', async ({ request, baseURL }) => {
    const res = await post(request, baseURL, {
      songName: 'simple-ballad', bpm: 120, timeSignature: '4/4', beatAnchor: -1,
    });
    expect(res.status()).toBe(400);
  });

  test('accepts an offsetMs within ±500 and rejects one outside', async ({ request, baseURL }) => {
    const base = { songName: 'simple-ballad', bpm: 120, timeSignature: '4/4', beatAnchor: 1 };
    expect((await post(request, baseURL, { ...base, offsetMs: -40 })).status()).toBe(200);
    for (const offsetMs of [501, -501]) {
      expect((await post(request, baseURL, { ...base, offsetMs })).status(), `offsetMs=${offsetMs}`).toBe(400);
    }
  });
});
