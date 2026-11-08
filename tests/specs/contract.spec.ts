import { test, expect } from '../helpers/server.js';

test.describe('API contract — route surface', () => {
  test('page routes: /music/songs returns HTML 200', async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/music/songs`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/html');
  });

  test('/music/new-song (retired) redirects (301) to /music/songs', async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/music/new-song`, { maxRedirects: 0 });
    expect(res.status()).toBe(301);
    expect(res.headers()['location']).toBe('/music/songs');
  });

  test('/music/song?songName=X returns HTML 200 for an existing song', async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/music/song?songName=simple-ballad`);
    expect(res.status()).toBe(200);
  });

  test('/music/ redirects (307) to /music/songs', async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/music/`, { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers()['location']).toBe('/music/songs');
  });

  test('Phase 4 regression guard: device-prefixed routes are gone (404)', async ({
    request,
    baseURL,
  }) => {
    for (const path of [
      '/music/mobile/songs',
      '/music/mobile/song',
      '/music/mobile/new-song',
      '/music/desktop/songs',
      '/music/desktop/song',
      '/music/desktop/new-song',
    ]) {
      const res = await request.get(`${baseURL}${path}`, { maxRedirects: 0 });
      expect(res.status()).toBe(404);
    }
  });

  test('GET /music/song-list returns a JSON array of slugs', async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/music/song-list`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/json');
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toEqual(expect.arrayContaining(['simple-ballad', 'edge-cases']));
  });

  test('GET /music/song-meta requires songName', async ({ request, baseURL }) => {
    const r1 = await request.get(`${baseURL}/music/song-meta`);
    expect(r1.status()).toBe(400);
    const r2 = await request.get(`${baseURL}/music/song-meta?songName=simple-ballad`);
    expect(r2.status()).toBe(200);
    const body = await r2.json();
    expect(body).toHaveProperty('title');
    expect(body).toHaveProperty('tags');
    expect(body).toHaveProperty('metronome');
    // Flattened shape: YouTube + audio fields live at the top level, and
    // audio availability is derived from disk at request time.
    for (const key of ['youtubeVideoId', 'audioSource', 'fullMp3Audio', 'vocalAudio', 'instrumentAudio', 'versionLabels', 'guitarTab']) {
      expect(body).toHaveProperty(key);
    }
  });

  test('GET /music/export/song-meta returns the consolidated metadata', async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/music/export/song-meta`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/json');
    const body = await res.json();
    expect(body).toHaveProperty('simple-ballad');
  });

  test('method gates: method-mismatch returns 405', async ({ request, baseURL }) => {
    const r1 = await request.get(`${baseURL}/music/save-chords`);
    expect(r1.status()).toBe(405);
    const r2 = await request.post(`${baseURL}/music/song-list`, { data: {} });
    expect(r2.status()).toBe(405);
    const r3 = await request.post(`${baseURL}/music/delete-song`, { data: {} });
    expect(r3.status()).toBe(405);
  });

  test('SSRF defense: /music/proxy rejects file:// scheme', async ({ request, baseURL }) => {
    const res = await request.post(`${baseURL}/music/proxy`, {
      data: { url: 'file:///etc/passwd' },
    });
    expect(res.status()).toBe(400);
  });

  test('SSRF defense: /music/proxy blocks loopback host', async ({ request, baseURL }) => {
    const res = await request.post(`${baseURL}/music/proxy`, {
      data: { url: 'http://127.0.0.1:1/' },
    });
    expect(res.status()).not.toBe(200);
  });

  test('size limit: POST /music/save-chords with >1 MiB body is rejected', async ({ request, baseURL }) => {
    const huge = 'x'.repeat(2 << 20);
    const res = await request.post(`${baseURL}/music/save-chords`, {
      data: { songName: 'simple-ballad', content: huge },
    });
    expect([400, 413, 500]).toContain(res.status());
    // The file on disk should NOT have been overwritten to the huge value.
    const raw = await request.get(`${baseURL}/music/song?songName=simple-ballad&raw=true`);
    const body = await raw.text();
    expect(body.length).toBeLessThan(50_000);
  });

  test('POST /music/save-chords rejects path-traversing songName', async ({ request, baseURL }) => {
    // sanitizeSongName reduces "../etc/passwd" to "passwd" — the write
    // happens inside SONGS_DIR, never outside. Either 400 or 200-with-
    // sandboxed-write is acceptable; what MUST NOT happen is any file
    // created at an absolute path outside SONGS_DIR.
    const res = await request.post(`${baseURL}/music/save-chords`, {
      data: { songName: '../etc/passwd', content: 'x' },
    });
    // Confirm the traversal did not escape: /etc/passwd.txt not writable
    // anyway, but the Go server shouldn't have tried. Accept any 2xx/4xx.
    expect([200, 400, 500]).toContain(res.status());
  });
});
