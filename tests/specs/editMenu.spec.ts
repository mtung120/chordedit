import { test, expect } from '../helpers/server.js';
import { SongViewPage } from '../helpers/pages/songView.js';

test.describe('song view — Edit ⋮ menu (raw text, tags, rename, delete)', () => {
  test('the menu lists Raw text first; it opens the raw text editor', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await sv.openEditMenu();
    await expect(sv.editMenu.getByRole('menuitem')).toHaveText(['Raw text', 'Tags…', 'Rename song', 'Delete song']);
    await sv.editMenu.getByRole('menuitem', { name: 'Raw text' }).click();
    await expect(sv.editMenu).toBeHidden();
    await expect(page.locator('.raw-text-editor')).toBeVisible();
    await expect(page.locator('.raw-text-area')).toBeFocused();
  });

  test('the ⋮ menu only exists in Edit mode', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await expect(sv.editMenuBtn).toBeHidden();
    await sv.setMode('practice');
    await expect(sv.editMenuBtn).toBeHidden();
    await sv.enterEditMode();
    await expect(sv.editMenuBtn).toBeVisible();
  });

  test('clicking ⋮ toggles the dropdown open/closed', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await sv.enterEditMode();
    await expect(sv.editMenu).toBeHidden();
    await sv.editMenuBtn.click();
    await expect(sv.editMenu).toBeVisible();
    await sv.editMenuBtn.click();
    await expect(sv.editMenu).toBeHidden();
  });

  test('clicking outside closes the dropdown', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await sv.openEditMenu();
    await sv.title.click();
    await expect(sv.editMenu).toBeHidden();
  });

  test('Tags… toggles the tag editor', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await sv.openEditMenu();
    await sv.editMenu.getByRole('menuitem', { name: 'Tags…' }).click();
    await expect(sv.editMenu).toBeHidden();
    await expect(sv.tagEditor).toBeVisible();
    await expect(sv.tagEditor.locator('.tag-chip')).toContainText(['Ballad']);
  });

  test('Rename song starts inline title editing', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await sv.openEditMenu();
    await sv.editMenu.getByRole('menuitem', { name: 'Rename song' }).click();
    await expect(sv.title.locator('input.title-inline-input')).toBeFocused();
  });

  test('a long title shows its first 25 characters + "…"; Rename edits the full title', async ({ page }) => {
    const sv = new SongViewPage(page);
    const full = 'Một Bài Hát Có Cái Tên Rất Là Dài';
    const renamed = 'Another Very Long Song Title Here';
    const res = await page.request.post('/music/rename-song', { data: { songName: 'simple-ballad', newTitle: full } });
    expect(res.ok()).toBe(true);
    await sv.goto('simple-ballad');
    await expect(sv.title).toHaveText('Một Bài Hát Có Cái Tên Rấ…');
    await expect(sv.title).toHaveAttribute('title', full);

    await sv.openEditMenu();
    await sv.editMenu.getByRole('menuitem', { name: 'Rename song' }).click();
    const input = sv.title.locator('input.title-inline-input');
    await expect(input).toHaveValue(full);
    await input.fill(renamed);
    const saved = page.waitForRequest((r) => r.url().includes('/music/rename-song'));
    await input.press('Enter');
    expect(JSON.parse((await saved).postData() ?? '{}').newTitle).toBe(renamed);
    await expect(sv.title).toHaveText('Another Very Long Song Ti…');
  });

  test('Delete song → confirm → song removed and redirect to home', async ({ page }) => {
    const sv = new SongViewPage(page);
    // Use a slug we can safely delete without breaking fixtures for later tests.
    await sv.goto('long-song');
    await sv.openEditMenu();

    page.once('dialog', (d) => void d.accept());
    await sv.editMenu.getByRole('menuitem', { name: 'Delete song' }).click();

    await expect(page).toHaveURL(/\/music\/songs/);
    await expect(page.locator('.song-count')).not.toHaveText('0 songs');

    // Direct fetch confirms the file is gone server-side.
    const res = await page.request.get('/music/song-list');
    const list = (await res.json()) as string[];
    expect(list).not.toContain('long-song');
  });

  test('Delete song → cancel → no DELETE fires, song remains', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad');
    await sv.openEditMenu();

    let deleteFired = false;
    page.on('request', (r) => {
      if (r.method() === 'DELETE' && r.url().includes('/music/delete-song')) {
        deleteFired = true;
      }
    });
    page.once('dialog', (d) => void d.dismiss());

    await sv.editMenu.getByRole('menuitem', { name: 'Delete song' }).click();
    await page.waitForTimeout(200);
    expect(deleteFired).toBe(false);
    await expect(page).toHaveURL(/\/music\/song\?songName=simple-ballad/);
  });

  test('server rejects a 201-character title on rename', async ({ request, baseURL }) => {
    const res = await request.post(`${baseURL}/music/rename-song`, {
      data: { songName: 'simple-ballad', newTitle: 'x'.repeat(201) },
    });
    expect(res.status()).toBe(400);
  });

  test('server rename happy path updates metadata title', async ({ request, baseURL }) => {
    const res = await request.post(`${baseURL}/music/rename-song`, {
      data: { songName: 'simple-ballad', newTitle: 'Renamed From Test' },
    });
    expect(res.status()).toBe(200);

    const meta = await request.get(`${baseURL}/music/song-meta?songName=simple-ballad`);
    const body = await meta.json();
    expect(body.title).toBe('Renamed From Test');
  });
});
