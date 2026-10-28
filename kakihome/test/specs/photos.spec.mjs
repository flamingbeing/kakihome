// Photos on this phone: a tiny thumbnail on the item, the photo itself read only when the item opens, remove, delete,
// the backup, and an old-style item (whole photo inside it) moved by itself. Run: npx playwright test photos
import fs from 'node:fs';
import { test, expect } from './fixtures.mjs';
import { open, hash, go, toast, noSideways, shot, SEEN } from './helpers.mjs';

const THUMB_MAX = 12288, PHOTO_MAX = 153600;

// a photo-like test picture (colours, shapes, text, a little grain), or pure noise for the worst case
const picture = (page, w, h, noise = false) => page.evaluate(async ([w, h, noise]) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#c0392b'); gr.addColorStop(0.5, '#f1c40f'); gr.addColorStop(1, '#2c3e50');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 60; i++) { g.fillStyle = `hsl(${rnd() * 360},60%,${30 + rnd() * 40}%)`; g.beginPath(); g.arc(rnd() * w, rnd() * h, 20 + rnd() * w / 6, 0, 7); g.fill(); }
  g.font = `bold ${Math.round(h / 8)}px sans-serif`; g.fillStyle = '#fff'; g.fillText('SOY SAUCE 500 ml', w * 0.1, h * 0.55);
  const img = g.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = noise ? 0 : (rnd() - 0.5) * 24; for (let k = 0; k < 3; k++) d[i + k] = noise ? rnd() * 255 : d[i + k] + n; }
  g.putImageData(img, 0, 0);
  const b = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
  return [...new Uint8Array(await b.arrayBuffer())];
}, [w, h, noise]).then(a => Buffer.from(a));
// the phone's own IndexedDB: idb(page, key) reads, idb(page, key, value) writes
const idb = (page, key, val) => page.evaluate(([k, v]) => new Promise((res, rej) => {
  const r = indexedDB.open('kakihome');
  r.onsuccess = () => {
    const t = r.result.transaction('docs', v === undefined ? 'readonly' : 'readwrite'), st = t.objectStore('docs');
    const q = v === undefined ? st.get(k) : st.put(v, k);
    t.oncomplete = () => { r.result.close(); res(v === undefined ? q.result ?? null : null); };
    t.onerror = () => rej(t.error);
  };
}), [key, val]);
const item = (page, id) => page.evaluate(id => window.__kakihome.S.items.get(id) || null, id);
const photoPhone = phone => open(phone, { init: SEEN });
// an item saved before 16 Oct 2026, with the whole photo inside it, then the app moves it to a thumbnail + photos/<id> by itself
async function legacyItem(page) {
  const legacy = await page.evaluate(async () => {
    const { pictures } = await import('/kakihome/js/photo.js');
    const c = document.createElement('canvas'); c.width = 640; c.height = 480; const g = c.getContext('2d');
    g.fillStyle = '#2a7'; g.fillRect(0, 0, 640, 480); g.fillStyle = '#fff'; g.fillRect(100, 100, 300, 200);
    const b = await new Promise(r => c.toBlob(r, 'image/png'));
    return (await pictures(b)).photo;
  });
  await idb(page, 'items/legacy1', { id: 'legacy1', name: 'Old photo item', brand: '', size: '', category: 'Other', location: 'Kitchen cabinet', openDays: null, lowAt: 0, barcode: '', photo: legacy, batches: [], createdAt: '2026-10-01T00:00:00Z' });
  await page.reload();
  await page.waitForFunction(() => { const i = window.__kakihome?.S.items.get('legacy1'); return i && !('photo' in i) && i.hasPhoto; }, null, { timeout: 15_000 });
  // the item is saved after its photo: both are in place when the saved item has only its thumbnail
  await expect.poll(async () => { const m = await idb(page, 'items/legacy1'); return !!m && !('photo' in m) && m.hasPhoto === true; }).toBe(true);
  return { legacy, migrated: await idb(page, 'items/legacy1'), legacyDoc: await idb(page, 'photos/legacy1') };
}

test('an old-style item with its whole photo moves to a thumbnail and photos/<id> by itself', async ({ phone }) => {
  const page = await photoPhone(phone);
  const { legacy, migrated, legacyDoc } = await legacyItem(page);
  expect(migrated && !('photo' in migrated) && migrated.hasPhoto === true && migrated.thumb.startsWith('data:image/jpeg') && migrated.thumb.length <= THUMB_MAX, 'old photo moved: the saved item keeps only a thumbnail').toBe(true);
  expect(legacyDoc?.data === legacy, 'and its photo, unchanged, is in photos/<id>').toBe(true);
  expect(migrated.name === 'Old photo item' && migrated.updatedBy === undefined, 'nothing else about the item changed').toBe(true);
});

test('a camera picture: thumbnail on the item, photo on its own, read only when the item opens; remove; delete and Undo', async ({ phone, axe }) => {
  const page = await photoPhone(phone);
  const jpeg = await picture(page, 1600, 1200);
  // add an item with a camera picture
  await go(page, '#/add');
  await page.fill('#kh-form [name="name"]', 'Photo test sauce');
  await page.setInputFiles('#kh-photo-file', { name: 'camera.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await page.locator('.kh-photo img').waitFor();
  await expect(page.locator('[data-act="photo-del"]'), 'the form offers Remove photo').toBeVisible();
  await page.click('#kh-save');
  await expect(page).toHaveURL(/#\/item\//);
  const id = hash(page).split('/')[2];
  await expect.poll(async () => (await item(page, id))?.hasPhoto === true && !!(await idb(page, 'photos/' + id))).toBe(true);
  const added = await item(page, id), doc = await idb(page, 'photos/' + id);
  expect(added.hasPhoto === true && !('photo' in added) && added.thumb.startsWith('data:image/jpeg'), 'the item holds a thumbnail, not the photo').toBe(true);
  expect(doc && doc.id === id && doc.data.startsWith('data:image/jpeg') && doc.data.length > added.thumb.length * 3, 'the photo is saved on its own').toBe(true);
  const dims = await page.evaluate(async ([a, b]) => {
    const size = src => new Promise(r => { const i = new Image(); i.onload = () => r([i.naturalWidth, i.naturalHeight]); i.src = src; });
    return [await size(a), await size(b)];
  }, [added.thumb, doc.data]);
  expect(dims, 'thumbnail 96x72, photo 480x360').toEqual([[96, 72], [480, 360]]);
  await expect(page.locator('#kh-hero'), 'the item screen shows the photo').toHaveAttribute('src', doc.data);
  await axe(page, 'item with a photo');
  await noSideways(page, 'item with a photo');
  await shot(page, '30-item-photo');
  // lists use the thumbnail
  await go(page, '#/items');
  await expect(page.locator('#kh-items-list a.ui-row', { hasText: 'Photo test sauce' }).locator('img.ui-row-thumb'), 'the list shows the thumbnail').toHaveAttribute('src', added.thumb);
  await go(page, '#/');
  expect(await page.evaluate(() => [...document.querySelectorAll('img')].every(i => !i.src.startsWith('data:') || i.src.length <= 12288)), 'Home has no full photos').toBe(true);

  // a fresh start reads the photo only when the item opens
  await page.reload();
  await page.waitForFunction(() => window.__kakihome?.S);
  expect(await page.evaluate(() => window.__kakihome.S.pics.size), 'nothing but thumbnails loaded at start').toBe(0);
  await go(page, '#/item/' + id);
  await expect(page.locator('#kh-hero')).toHaveAttribute('src', doc.data);
  expect(await page.evaluate(id => window.__kakihome.S.pics.get(id)?.data?.length, id), 'opening the item fetched its photo').toBe(doc.data.length);

  // remove the photo: both go
  await page.click('[data-act="edit"]');
  await expect(page.locator('.kh-photo img'), 'edit shows the thumbnail').toHaveAttribute('src', added.thumb);
  await page.click('[data-act="photo-del"]');
  await page.click('#kh-save');
  await expect(page).toHaveURL(/#\/item\//);
  await expect.poll(async () => { const b = await item(page, id); return !b.thumb && !b.hasPhoto && !('photo' in b); }, { message: 'Remove photo clears the thumbnail' }).toBe(true);
  await expect.poll(() => idb(page, 'photos/' + id), { message: 'and deletes the photo' }).toBeNull();
  await expect(page.locator('#kh-hero'), 'the item shows no picture').toHaveCount(0);

  // a new photo again, then delete the item: its photo goes too, and Undo brings both back
  await page.click('[data-act="edit"]');
  await page.setInputFiles('#kh-photo-file', { name: 'camera.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await page.locator('.kh-photo img').waitFor();
  await page.click('#kh-save');
  await expect(page).toHaveURL(/#\/item\//);
  await expect.poll(async () => (await idb(page, 'photos/' + id))?.data?.startsWith('data:image/jpeg'), { message: 'a new photo is saved' }).toBe(true);
  const again = await idb(page, 'photos/' + id);
  await page.click('[data-act="delete"]');
  await expect.poll(async () => (await idb(page, 'photos/' + id)) === null && (await idb(page, 'items/' + id)) === null, { message: 'deleting the item deletes its photo' }).toBe(true);
  await toast(page).locator('.toast-action').click();
  await expect.poll(async () => (await idb(page, 'photos/' + id))?.data === again.data && !!(await idb(page, 'items/' + id))?.hasPhoto, { message: 'Undo brings the item and its photo back' }).toBe(true);
  await go(page, '#/item/' + id);
  await page.click('[data-act="delete"]');
  await expect.poll(() => idb(page, 'photos/' + id), { message: 'deleted again: the photo is gone' }).toBeNull();
});

test('the backup holds the photos and the thumbnails', async ({ phone }) => {
  const page = await photoPhone(phone);
  const { legacy, migrated } = await legacyItem(page);
  await go(page, '#/settings');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="backup"]')]);
  const backup = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  expect(backup.photos?.length === 1 && backup.photos[0].id === 'legacy1' && backup.photos[0].data === legacy, 'the backup includes the photos').toBe(true);
  expect(backup.items.find(i => i.id === 'legacy1')?.thumb, 'and the items their thumbnails').toBe(migrated.thumb);
});

test('every picture fits the rules: a camera-like JPEG and pure noise (the worst case)', async ({ phone }) => {
  const page = await photoPhone(phone);
  const jpeg = await picture(page, 1600, 1200), noise = await picture(page, 1600, 1200, true);
  const sizes = await page.evaluate(async bufs => {
    const { pictures } = await import('/kakihome/js/photo.js');
    const out = [];
    for (const b of bufs) { const p = await pictures(new Blob([new Uint8Array(b)], { type: 'image/jpeg' })); out.push([p.thumb.length, p.photo.length]); }
    return out;
  }, [[...jpeg], [...noise]]);
  expect(sizes.every(([t, p]) => t <= THUMB_MAX && p <= PHOTO_MAX), 'every picture fits the rules').toBe(true);
  console.log(`photo sizes (data URL bytes): camera-like 1600x1200 JPEG (${jpeg.length} B) -> thumb ${sizes[0][0]}, photo ${sizes[0][1]}; noise (${noise.length} B) -> thumb ${sizes[1][0]}, photo ${sizes[1][1]}`);
});
