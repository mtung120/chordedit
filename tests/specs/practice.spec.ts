import { test, expect } from '../helpers/server.js';
import { SongViewPage } from '../helpers/pages/songView.js';
import {
  openPractice,
  stubAudioReady,
  stubDownloadAudio,
  stubStemSeparation,
  stubYouTubeSearch,
} from '../helpers/media.js';

/**
 * Practice panel media controls (src/features/videoPlayer/videoPlayer.ts).
 *
 * Fixtures: `ConMuaNho` has a YouTube source (videoId + title,
 * audioSource "youtube"); `simple-ballad` has no audio source.
 *
 * Real audio playback (Tone.js output, pitch shifting, metronome clicks)
 * isn't asserted here — headless audio output isn't observable. These
 * tests cover the UI state machine and the requests it sends.
 */

/** Distinct tops of the Stems / Speed / Pitch / Metronome rows on screen. */
async function settingTops(sv: SongViewPage): Promise<number[]> {
  const tops = await sv.practicePanel
    .locator('.stem-selector, .speed-selector, .ps-controls, .metronome-row')
    .evaluateAll((els) =>
      els.filter((el) => el.getClientRects().length > 0).map((el) => Math.round(el.getBoundingClientRect().top)),
    );
  return [...new Set(tops)];
}

test.describe('Practice — source line + source picker', () => {
  test('source line shows the configured video title', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('ConMuaNho');
    await openPractice(sv);
    await expect(sv.practicePanel.locator('.vp-source-title')).toHaveText('Cơn Mưa Nhỏ — Official');
  });

  test('media controls are not visible outside Practice mode', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('ConMuaNho');
    await expect(sv.practicePanel.locator('.vp-source-row')).not.toBeInViewport();
    await sv.setMode('edit');
    await expect(sv.practicePanel.locator('.vp-source-row')).not.toBeInViewport();
  });

  test('no-source song shows the YouTube/Upload picker and hides playback controls', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await openPractice(sv);

    const toggle = sv.practicePanel.locator('.vp-mode-toggle');
    await expect(toggle.locator('button', { hasText: 'YouTube' })).toHaveClass(/active/);
    await expect(sv.practicePanel.locator('.yt-search-input')).toBeVisible();
    await expect(sv.practicePanel.locator('.vp-upload-bar')).toBeHidden();
    await expect(sv.practicePanel.locator('.vp-source-row')).toBeHidden();
    await expect(sv.practicePanel.locator('.vp-cancel-setup')).toBeHidden();
    await expect(sv.practicePanel.locator('.yt-controls')).toBeHidden();

    // The search starts from the song's title.
    await expect(sv.practicePanel.getByRole('searchbox', { name: 'Search YouTube' })).toHaveValue(
      (await page.locator('#song-title-heading').getAttribute('data-title'))!,
    );

    // Switch to upload and back. Upload waits for a file, then names it.
    await toggle.locator('button', { hasText: 'Upload mp3' }).click();
    await expect(sv.practicePanel.locator('.vp-upload-bar')).toBeVisible();
    await expect(sv.practicePanel.locator('.yt-search-bar')).toBeHidden();
    const upload = sv.practicePanel.getByRole('button', { name: 'Upload', exact: true });
    await expect(upload).toBeDisabled();
    await sv.practicePanel.locator('.vp-file-input').setInputFiles({
      name: 'take-1.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('ID3'),
    });
    await expect(sv.practicePanel.locator('.vp-file-pick')).toHaveText('take-1.mp3');
    await expect(upload).toBeEnabled();
    await toggle.locator('button', { hasText: 'YouTube' }).click();
    await expect(sv.practicePanel.locator('.yt-search-bar')).toBeVisible();
  });

  test('song with a video: the title links to it on YouTube (no embedded player); Change', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('ConMuaNho');
    await openPractice(sv);

    await expect(sv.practicePanel.locator('iframe')).toHaveCount(0);
    await expect(sv.practicePanel.locator('.vp-mode-toggle')).toBeHidden();
    await expect(sv.practicePanel.locator('.yt-search-bar')).toBeHidden();
    const row = sv.practicePanel.locator('.vp-source-row');
    const title = row.getByRole('link', { name: 'Cơn Mưa Nhỏ — Official' });
    await expect(title).toHaveAttribute('href', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await expect(title).toHaveAttribute('target', '_blank');
    await expect(row.getByRole('button', { name: 'Change' })).toBeVisible();
  });

  test('no audio is fetched until Practice first opens', async ({ page }) => {
    await stubAudioReady(page);
    const audio: string[] = [];
    page.on('request', (r) => {
      if (/\/music\/(audio|download-audio)/.test(r.url())) audio.push(r.url());
    });
    const sv = new SongViewPage(page);
    await sv.goto('ConMuaNho');
    await page.waitForLoadState('networkidle');
    expect(audio).toEqual([]);

    await openPractice(sv);
    await expect(sv.practicePanel.locator('.yt-controls')).toBeVisible();
    expect(audio.length).toBeGreaterThan(0);
  });

  test('Change re-opens the source picker; Cancel closes it again', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('ConMuaNho');
    await openPractice(sv);
    await sv.practicePanel.getByRole('button', { name: 'Change' }).click();
    await expect(sv.practicePanel.locator('.vp-mode-toggle')).toBeVisible();
    await expect(sv.practicePanel.locator('.yt-search-input')).toBeVisible();
    await expect(sv.practicePanel.locator('.vp-source-row')).toBeHidden();
    await sv.practicePanel.getByRole('button', { name: 'Cancel' }).click();
    await expect(sv.practicePanel.locator('.vp-source-row')).toBeVisible();
    await expect(sv.practicePanel.locator('.yt-search-input')).toBeHidden();
  });
});

test.describe('Practice — YouTube search', () => {
  test('search button shows results with title + channel', async ({ page }) => {
    await stubYouTubeSearch(page);
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await openPractice(sv);

    await sv.practicePanel.locator('.yt-search-input').fill('test song');
    await sv.practicePanel.locator('.yt-search-btn').click();

    await expect(sv.practicePanel.locator('.yt-result-item')).toHaveCount(2);
    await expect(sv.practicePanel.locator('.yt-result-title').first()).toHaveText('Test Song Title');
    await expect(sv.practicePanel.locator('.yt-result-channel').first()).toHaveText('Test Artist');
  });

  test('Enter key triggers search', async ({ page }) => {
    await stubYouTubeSearch(page);
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await openPractice(sv);

    await sv.practicePanel.locator('.yt-search-input').fill('test');
    await sv.practicePanel.locator('.yt-search-input').press('Enter');
    await expect(sv.practicePanel.locator('.yt-result-item')).toHaveCount(2);
  });

  test('empty results show "No videos found"', async ({ page }) => {
    const sv = new SongViewPage(page); // default stub returns []
    await sv.goto('simple-ballad');
    await openPractice(sv);

    await sv.practicePanel.locator('.yt-search-input').fill('xyznonexistent');
    await sv.practicePanel.locator('.yt-search-btn').click();
    await expect(sv.practicePanel.locator('.yt-no-results')).toHaveText('No videos found');
  });

  test('clicking outside the widget closes the results', async ({ page }) => {
    await stubYouTubeSearch(page);
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await openPractice(sv);

    await sv.practicePanel.locator('.yt-search-input').fill('test');
    await sv.practicePanel.locator('.yt-search-btn').click();
    await expect(sv.practicePanel.locator('.yt-results')).toBeVisible();

    await sv.title.click();
    await expect(sv.practicePanel.locator('.yt-results')).toBeHidden();
  });

  test('picking a result saves it and swaps to the source line', async ({ page }) => {
    await stubYouTubeSearch(page);
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await openPractice(sv);

    const saveReqP = page.waitForRequest(
      (r) => r.url().includes('/music/save-youtube-settings') && r.method() === 'POST',
    );
    await sv.practicePanel.locator('.yt-search-input').fill('test');
    await sv.practicePanel.locator('.yt-search-btn').click();
    await sv.practicePanel.locator('.yt-result-item').first().click();

    const body = JSON.parse((await saveReqP).postData() ?? '{}');
    expect(body).toEqual({ songName: 'simple-ballad', videoId: 'testVid123', title: 'Test Song Title' });

    await expect(sv.practicePanel.locator('.yt-results')).toBeHidden();
    await expect(sv.practicePanel.locator('.vp-source-title')).toHaveText('Test Song Title');
    await expect(sv.practicePanel.locator('.vp-source-row')).toBeVisible();
    await expect(sv.practicePanel.locator('.vp-source-title')).toHaveAttribute(
      'href',
      'https://www.youtube.com/watch?v=testVid123',
    );
  });
});

test.describe('Practice — audio preparation', () => {
  test('download failure shows the error and keeps controls hidden', async ({ page }) => {
    await stubDownloadAudio(page, 'error');
    const sv = new SongViewPage(page);
    await sv.goto('ConMuaNho');
    await openPractice(sv);

    await expect(sv.practicePanel.locator('.vp-status')).toHaveText('Audio download failed: yt-dlp failed');
    await expect(sv.practicePanel.locator('.yt-controls')).toBeHidden();
  });

  test('in-progress download shows a simple status message', async ({ page }) => {
    await stubDownloadAudio(page, 'downloading');
    const sv = new SongViewPage(page);
    await sv.goto('ConMuaNho');
    await openPractice(sv);

    await expect(sv.practicePanel.locator('.vp-status')).toHaveText('Downloading audio…');
    await expect(sv.practicePanel.locator('.yt-controls')).toBeHidden();
  });

  test('ready audio reveals playback, pitch, speed and metronome controls', async ({ page }) => {
    await stubAudioReady(page);
    const sv = new SongViewPage(page);
    await sv.goto('ConMuaNho');
    await openPractice(sv);

    const controls = sv.practicePanel.locator('.yt-controls');
    await expect(controls).toBeVisible();
    await expect(controls.locator('.yt-play-btn')).toHaveText('▶');
    await expect(controls.locator('.yt-time')).toContainText('0:00 /');
    await expect(controls.locator('.ps-controls .ps-display')).toHaveText('0');
    await expect(controls.getByLabel('Speed')).toHaveValue('100');
    await expect(controls.locator('.metronome-chip')).toBeVisible();
    // No stems on disk for this fixture → only the "Separate stems" button.
    const stemRow = controls.locator('.stem-selector');
    await expect(stemRow.locator('.separate-stems-btn')).toBeVisible();
    await expect(stemRow.locator('.stem-btn')).toHaveCount(3);
    for (const btn of await stemRow.locator('.stem-btn').all()) await expect(btn).toBeHidden();
  });

  test('"Separate stems" runs server separation, then reveals the stem buttons', async ({ page }) => {
    await stubAudioReady(page);
    const stems = await stubStemSeparation(page);
    const sv = new SongViewPage(page);
    await sv.goto('ConMuaNho');
    await openPractice(sv);

    const stemRow = sv.practicePanel.locator('.stem-selector');
    const separate = stemRow.locator('.separate-stems-btn');
    await separate.click();
    await expect.poll(stems.posted).toBe(true);
    await expect(separate).toBeDisabled();
    await expect(separate).toHaveText('Separating…');
    await expect(sv.practicePanel.locator('.vp-status')).toHaveText('Separating stems… this takes a few minutes.');

    // The UI polls every 5 s; the next poll reports ready.
    const vocals = stemRow.locator('.stem-btn', { hasText: 'Vocals' });
    await expect(vocals).toBeVisible({ timeout: 15_000 });
    await expect(vocals).toBeEnabled();
    await expect(stemRow.locator('.stem-btn')).toHaveText(['Full', 'Vocals', 'Backing']);
    await expect(separate).toBeHidden();
  });

  test('a stem loads the first time it is picked, not before', async ({ page }) => {
    await stubAudioReady(page);
    await stubStemSeparation(page);
    const stemFetches: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'GET' && /_(vocals|accompaniment)\.mp3/.test(decodeURIComponent(r.url()))) {
        stemFetches.push(r.url());
      }
    });
    const sv = new SongViewPage(page);
    await sv.goto('ConMuaNho');
    await openPractice(sv);

    const stemRow = sv.practicePanel.locator('.stem-selector');
    await stemRow.locator('.separate-stems-btn').click();
    const vocals = stemRow.locator('.stem-btn', { hasText: 'Vocals' });
    await expect(vocals).toBeVisible({ timeout: 15_000 });
    expect(stemFetches).toEqual([]);

    await vocals.click();
    await expect(vocals).toHaveClass(/active/);
    expect(stemFetches).toHaveLength(1);
    expect(decodeURIComponent(stemFetches[0]!)).toContain('_vocals.mp3');
  });

  test('pitch buttons step and reset the semitone display', async ({ page }) => {
    await stubAudioReady(page);
    const sv = new SongViewPage(page);
    await sv.goto('ConMuaNho');
    await openPractice(sv);

    const row = sv.practicePanel.locator('.ps-controls');
    const display = row.locator('.ps-display');
    await row.getByRole('button', { name: '+' }).click();
    await row.getByRole('button', { name: '+' }).click();
    await expect(display).toHaveText('+2');
    await row.getByRole('button', { name: '−' }).click();
    await row.getByRole('button', { name: '−' }).click();
    await row.getByRole('button', { name: '−' }).click();
    await expect(display).toHaveText('-1');
    await row.getByRole('button', { name: 'Reset' }).click();
    await expect(display).toHaveText('0');
  });

  for (const width of [900, 1024]) {
    test(`wide touch screen (${width}px): Stems · Speed · Pitch · Metronome share one line`, async ({ browser, baseURL }) => {
      const ctx = await browser.newContext({ baseURL, viewport: { width, height: 700 }, hasTouch: true });
      const page = await ctx.newPage();
      await stubAudioReady(page);
      // A set-up metronome (switch + "72 BPM · 4/4").
      await page.route('**/music/song-meta?songName=ConMuaNho', async (route) => {
        const res = await route.fetch();
        const metronome = { bpm: 72, timeSignature: '4/4', beatAnchor: 0.5 };
        await route.fulfill({ response: res, json: { ...(await res.json()), metronome } });
      });
      const sv = new SongViewPage(page);
      await sv.goto('ConMuaNho');
      await openPractice(sv);
      // Widest case: the Full / Vocals / Backing control (the fixture has no
      // stems, so show it in place of "Separate stems"), and Reset showing.
      await sv.practicePanel.locator('.stem-selector').evaluate((row) => {
        row.querySelectorAll<HTMLElement>('.vp-seg, .stem-btn').forEach((el) => (el.hidden = false));
        row.querySelector<HTMLElement>('.separate-stems-btn')!.parentElement!.hidden = true;
      });
      await sv.practicePanel.locator('.ps-btn', { hasText: '+' }).click();
      expect(await settingTops(sv)).toHaveLength(1);
      await ctx.close();
    });
  }

  test('wide touch screen: no stems and no metronome yet still fit one line', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, viewport: { width: 900, height: 700 }, hasTouch: true });
    const page = await ctx.newPage();
    await stubAudioReady(page);
    const sv = new SongViewPage(page);
    await sv.goto('ConMuaNho');
    await openPractice(sv);
    await expect(sv.practicePanel.locator('.separate-stems-btn')).toBeVisible();
    await expect(sv.practicePanel.locator('.metronome-chip')).toHaveText('Set up');
    expect(await settingTops(sv)).toHaveLength(1);
    await ctx.close();
  });

  for (const [width, lines] of [[700, 2], [390, 3]] as const) {
    test(`upright phone (${width}px): the four settings take ${lines} lines`, async ({ browser, baseURL }) => {
      const ctx = await browser.newContext({ baseURL, viewport: { width, height: 900 }, hasTouch: true });
      const page = await ctx.newPage();
      await stubAudioReady(page);
      const sv = new SongViewPage(page);
      await sv.goto('ConMuaNho');
      await openPractice(sv);
      await expect(sv.practicePanel.locator('.metronome-chip')).toBeVisible();
      expect(await settingTops(sv)).toHaveLength(lines);
      await ctx.close();
    });
  }

  test('wide touch screen: the speed slider stays clear of Pitch; Reset sits beside its label', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, viewport: { width: 1000, height: 703 }, hasTouch: true });
    const page = await ctx.newPage();
    await stubAudioReady(page);
    const sv = new SongViewPage(page);
    await sv.goto('ConMuaNho');
    await openPractice(sv);

    const slider = sv.practicePanel.getByLabel('Speed');
    const pitch = sv.practicePanel.locator('.ps-controls .vp-stepper');
    for (const value of ['100', '85']) {
      await slider.fill(value);
      const s = (await slider.boundingBox())!;
      const p = (await pitch.boundingBox())!;
      expect(s.x + s.width, `speed ${value}%`).toBeLessThan(p.x);
    }
    const label = (await sv.practicePanel.locator('.speed-selector .vp-row-label').boundingBox())!;
    const reset = (await sv.practicePanel.locator('.speed-selector .vp-reset').boundingBox())!;
    expect(Math.abs(reset.y + reset.height / 2 - (label.y + label.height / 2))).toBeLessThan(3);
    expect(reset.x).toBeGreaterThan(label.x + label.width);
    expect(reset.x - (label.x + label.width)).toBeLessThan(16);
    await ctx.close();
  });

  test('the speed slider runs 50–120% in 5% steps; Reset shows off 100%', async ({ page }) => {
    await stubAudioReady(page);
    const sv = new SongViewPage(page);
    await sv.goto('ConMuaNho');
    await openPractice(sv);

    const slider = sv.practicePanel.getByLabel('Speed');
    await expect(slider).toHaveAttribute('min', '50');
    await expect(slider).toHaveAttribute('max', '120');
    await expect(slider).toHaveAttribute('step', '5');
    const value = sv.practicePanel.locator('.speed-selector .vp-row-value');
    const reset = sv.practicePanel.locator('.speed-selector .vp-reset');
    await expect(value).toHaveText('100%');
    await expect(reset).toBeHidden();

    await slider.fill('85');
    await expect(value).toHaveText('85%');
    await expect(reset).toBeVisible();
    await slider.fill('115');
    await expect(value).toHaveText('115%');
    await reset.click();
    await expect(value).toHaveText('100%');
    await expect(slider).toHaveValue('100');
    await expect(reset).toBeHidden();
  });
});

test.describe('Practice — server contract', () => {
  test('youtube-search returns 503 when YOUTUBE_API_KEY is unset', async ({ request, baseURL }) => {
    // The test server is spawned with YOUTUBE_API_KEY="" (see server.ts).
    const res = await request.get(`${baseURL}/music/youtube-search?q=test`);
    expect(res.status()).toBe(503);
    expect((await res.json()).error).toContain('YouTube');
  });

  test('save-youtube-settings requires songName and a safe videoId', async ({ request, baseURL }) => {
    const missing = await request.post(`${baseURL}/music/save-youtube-settings`, {
      data: { videoId: 'x', title: 'y' },
    });
    expect(missing.status()).toBe(400);
    const traversal = await request.post(`${baseURL}/music/save-youtube-settings`, {
      data: { songName: 'simple-ballad', videoId: '../../etc', title: 'y' },
    });
    expect(traversal.status()).toBe(400);
  });

  test('the old stem upload endpoint is gone', async ({ request, baseURL }) => {
    const res = await request.post(`${baseURL}/music/upload-stems`);
    expect(res.status()).toBe(404);
  });

  test('download-audio rejects unsafe video IDs', async ({ request, baseURL }) => {
    const res = await request.post(`${baseURL}/music/download-audio`, {
      data: { songName: 'simple-ballad', videoId: '../../x' },
    });
    expect(res.status()).toBe(400);
  });
});
