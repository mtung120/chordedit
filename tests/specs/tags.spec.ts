import { test, expect } from '../helpers/server.js';
import { SongViewPage } from '../helpers/pages/songView.js';

/** Edit mode → ⋮ → Tags… opens the tag editor. */
async function expandTags(sv: SongViewPage) {
  await sv.openEditMenu();
  await sv.editMenu.getByRole('menuitem', { name: 'Tags…' }).click();
  await expect(sv.tagEditor).toBeVisible();
}

/** Picks `tag` in the add select and returns the tags it saved. */
async function addTag(sv: SongViewPage, tag: string): Promise<string[]> {
  const saveReqP = sv.page.waitForRequest(
    (r) => r.url().includes('/music/save-song-tags') && r.method() === 'POST',
    { timeout: 5000 },
  );
  await sv.tagEditor.locator('.add-tag-select').selectOption(tag);
  const body = JSON.parse((await saveReqP).postData() ?? '{}');
  return body.tags;
}

test.describe('song view — tags widget', () => {
  test('pre-existing tags render as chips', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad'); // Ballad
    await expandTags(sv);
    await expect(sv.tagEditor.locator('.tag-chip')).toHaveText(['Ballad×']);
  });

  test('the add select offers the user tags, not the retired or derived ones', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('edge-cases'); // no tags
    await expandTags(sv);
    await expect(sv.tagEditor.locator('.add-tag-select option:not([disabled])')).toHaveText([
      'Verified', 'Gig-ready', 'Ballad', 'Sôi động',
    ]);
  });

  test('adding a tag saves the new tag set', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('edge-cases');
    await expandTags(sv);
    expect(await addTag(sv, 'Verified')).toEqual(['Verified']);
  });

  test('a tag replaces the other tag of its group', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('extended-chords'); // Verified, Sôi động
    await expandTags(sv);
    expect(await addTag(sv, 'Gig-ready')).toEqual(['Sôi động', 'Gig-ready']);
    expect(await addTag(sv, 'Ballad')).toEqual(['Gig-ready', 'Ballad']);
    await expect(sv.tagEditor.locator('.tag-chip')).toHaveText(['Gig-ready×', 'Ballad×']);
  });

  test('removing a tag fires POST with remaining tags', async ({ page }) => {
    const sv = new SongViewPage(page);
    await sv.goto('simple-ballad'); // Ballad
    await expandTags(sv);

    const saveReqP = page.waitForRequest(
      (r) => r.url().includes('/music/save-song-tags') && r.method() === 'POST',
      { timeout: 5000 },
    );
    await sv.tagEditor.locator('.tag-chip-remove').first().click();
    const req = await saveReqP;
    const body = JSON.parse(req.postData() ?? '{}');
    expect(body.tags).toEqual([]);
  });

  test('server rejects an unknown tag with 400', async ({ request, baseURL }) => {
    for (const tag of ['Rock', 'Audio']) {
      const res = await request.post(`${baseURL}/music/save-song-tags`, {
        data: { songName: 'simple-ballad', tags: [tag] },
      });
      expect(res.status()).toBe(400);
    }
  });

  test('server rejects more tags than groups with 400', async ({ request, baseURL }) => {
    const res = await request.post(`${baseURL}/music/save-song-tags`, {
      data: { songName: 'simple-ballad', tags: ['Verified', 'Ballad', 'Verified'] },
    });
    expect(res.status()).toBe(400);
  });

  test('GET /music/tag-config returns the tag set', async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/music/tag-config`);
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({
      groups: [['Verified', 'Gig-ready'], ['Ballad', 'Sôi động']],
      implies: { 'Gig-ready': ['Verified'] },
      auto: ['Audio', 'Stems'],
    });
  });
});
