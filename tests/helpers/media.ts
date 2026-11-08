import { expect, type Page } from '@playwright/test';
import type { SongViewPage } from './pages/songView.js';

/**
 * Stubs for the Media tool card (src/features/videoPlayer). The card's
 * audio pipeline is: POST /music/download-audio → poll HEAD /music/audio →
 * GET /music/audio (decoded by Tone.js). installNetworkStubs() already
 * makes download-audio fail by default; these helpers override that.
 */

export interface YTResult {
  videoId: string;
  title: string;
  channel: string;
}

export const TWO_RESULTS: YTResult[] = [
  { videoId: 'testVid123', title: 'Test Song Title', channel: 'Test Artist' },
  { videoId: 'testVid456', title: 'Another Song', channel: 'Another Artist' },
];

export async function stubYouTubeSearch(page: Page, results: YTResult[] = TWO_RESULTS): Promise<void> {
  await page.route('**/music/youtube-search**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        results.map((r) => ({ ...r, thumbnail: `https://i.ytimg.com/vi/${r.videoId}/default.jpg` })),
      ),
    });
  });
  // Thumbnails are external images — answer them so the default-deny
  // handler doesn't log noise.
  await page.route('**://i.ytimg.com/**', (route) => route.fulfill({ status: 204 }));
}

export async function stubDownloadAudio(
  page: Page,
  status: 'ready' | 'downloading' | 'error',
): Promise<void> {
  const body =
    status === 'ready'
      ? { status: 'ready', url: '/music/audio?file=youtube/x_full.mp3' }
      : status === 'downloading'
        ? { status: 'downloading' }
        : { status: 'error', error: 'yt-dlp failed' };
  await page.route('**/music/download-audio', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }),
  );
}

/** One second of silent 8 kHz mono WAV — small and decodable by Chromium. */
function silentWav(): Buffer {
  const sampleRate = 8000;
  const samples = sampleRate;
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples * 2, 40);
  return buf;
}

/** Make every /music/audio request succeed with decodable silence. */
export async function stubAudioFiles(page: Page): Promise<void> {
  const wav = silentWav();
  await page.route('**/music/audio?**', (route) =>
    route.request().method() === 'HEAD'
      ? route.fulfill({ status: 200 })
      : route.fulfill({ status: 200, contentType: 'audio/wav', body: wav }),
  );
}

/** Full happy path: download reports ready and audio decodes. */
export async function stubAudioReady(page: Page): Promise<void> {
  await stubDownloadAudio(page, 'ready');
  await stubAudioFiles(page);
}

/**
 * Stem separation: GET status is "none" until the POST, then "ready", and
 * /song-meta starts listing stems — what the server reports once Demucs
 * finishes. `posted()` reports whether the POST was sent.
 */
export async function stubStemSeparation(page: Page): Promise<{ posted: () => boolean }> {
  let posted = false;
  await page.route('**/music/separate-stems**', (route) => {
    if (route.request().method() === 'POST') posted = true;
    const status = route.request().method() === 'POST' ? 'separating' : posted ? 'ready' : 'none';
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status }) });
  });
  await page.route('**/music/song-meta**', async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    if (posted) {
      json.vocalAudio = 'youtube/x_vocals.mp3';
      json.instrumentAudio = 'youtube/x_accompaniment.mp3';
    }
    await route.fulfill({ response, json });
  });
  return { posted: () => posted };
}

/** Switch to Practice mode, where the media controls live. */
export async function openPractice(sv: SongViewPage): Promise<void> {
  await sv.setMode('practice');
  await expect(sv.practicePanel.locator('.video-player-container')).toBeVisible();
}
