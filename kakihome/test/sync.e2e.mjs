// Household sharing against the local Firebase emulators (fake accounts, demo-kakihome project; never the live one):
// one person starts Kaki Home and adds another, both see each other's changes, an outsider sees nothing, photos (members only, size caps, old-style photos moved by the app), the owner
// can't be removed, and signing out goes back to the phone's own list.
// Run: kakihome/test/run-sync.sh
import assert from 'node:assert/strict';
import { serve } from './serve.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright/index.mjs');

const srv = await serve();
const browser = await chromium.launch();
const url = srv.url + '/kakihome/?emulator';
const errors = [];
const settle = p => p.waitForTimeout(400);
async function person(email) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(email + ': ' + e.message));
  if (process.env.DEBUG) page.on('console', m => console.log(email, m.type(), m.text()));
  await page.goto(url + '#/settings');
  await page.waitForFunction(() => window.__kakihome?.signIn);
  await page.evaluate(e => window.__kakihome.signIn(e), email);
  await page.locator('#main', { hasText: email }).waitFor();
  return page;
}
// The emulator's admin door ("Bearer owner" skips the rules): seeds what today's rules no longer let anyone write.
const FS = `http://${process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085'}/v1/projects/demo-kakihome/databases/(default)/documents/`;
const val = v => v === null ? { nullValue: null } : typeof v === 'string' ? { stringValue: v } : typeof v === 'number' ? { integerValue: String(v) }
  : typeof v === 'boolean' ? { booleanValue: v } : Array.isArray(v) ? { arrayValue: { values: v.map(val) } } : { mapValue: { fields: fields(v) } };
const fields = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, val(v)]));
const unval = v => 'stringValue' in v ? v.stringValue : 'booleanValue' in v ? v.booleanValue : 'integerValue' in v ? Number(v.integerValue)
  : 'nullValue' in v ? null : 'arrayValue' in v ? (v.arrayValue.values || []).map(unval) : 'mapValue' in v ? unfields(v.mapValue.fields || {}) : undefined;
const unfields = f => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, unval(v)]));
const admin = {
  async put(path, o) { const r = await fetch(FS + path, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify({ fields: fields(o) }) }); assert.ok(r.ok, 'seed ' + path); },
  async list(path) { const r = await fetch(FS + path + '?pageSize=100', { headers: { Authorization: 'Bearer owner' } }); const j = r.ok ? await r.json() : {}; return (j.documents || []).map(d => unfields(d.fields || {})); },
  async del(path) { const r = await fetch(FS + path, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } }); assert.ok(r.ok, 'delete ' + path); },
  async get(path) { const r = await fetch(FS + path, { headers: { Authorization: 'Bearer owner' } }); return r.ok ? unfields((await r.json()).fields || {}) : null; },
};
const go = async (p, h) => { await p.evaluate(x => { location.hash = x; }, h); await settle(p); };
const sub = (p, name) => p.locator('#kh-items-list .ha-row', { hasText: name }).locator('.ha-row-sub');
try {
  const mum = await person('mum@example.com');
  await mum.click('[data-act="hh-create"]');
  await mum.locator('#main .ha-row-title', { hasText: 'Our home' }).waitFor();
  await mum.fill('#kh-member-email', 'Dad@Example.com');
  await mum.click('#kh-member-add button[type=submit]');
  await mum.locator('#main .ha-row-title', { hasText: 'dad@example.com' }).waitFor();
  // an invite from Mum's own mail app: the toast offers it, and Dad's card keeps it for later
  await mum.locator('.ha-toast-action', { hasText: 'Email invite' }).waitFor();
  await mum.click('[data-act="person"][data-v="dad@example.com"]'); await settle(mum);
  const card = mum.locator('dialog.ha-sheet[open]');
  assert.equal(await card.locator('.ha-sheet-title').textContent(), 'Household member');
  assert.equal(await card.locator('[data-act="member-del"]').count(), 1, 'Stop sharing on someone else');
  const invite = await card.locator('a', { hasText: 'Email an invite' }).getAttribute('href');
  assert.match(invite, /^mailto:dad%40example\.com\?subject=Our%20household%20on%20Kaki%20Home&body=/);
  assert.match(decodeURIComponent(invite), /Continue with Google \(or Use email instead\), using this email address \(dad@example\.com\)/);
  // name him: the list shows the name with the email underneath
  await mum.fill('#kh-person-name', '  Dad  ');
  if (process.env.SHOTS) await mum.screenshot({ path: process.env.SHOTS + '/person-card.png' });
  await card.locator('button[type=submit]').click(); await settle(mum);
  await mum.locator('[data-act="person"][data-v="dad@example.com"] .ha-row-title', { hasText: 'Dad' }).waitFor();
  assert.match(await mum.locator('[data-act="person"][data-v="dad@example.com"] .ha-row-sub').textContent(), /dad@example\.com/);
  if (process.env.SHOTS) await mum.screenshot({ path: process.env.SHOTS + '/people-list.png', fullPage: true });
  // the owner's own card: no Stop sharing
  await mum.click('[data-act="person"][data-v="mum@example.com"]'); await settle(mum);
  assert.equal(await mum.locator('dialog.ha-sheet[open] [data-act="member-del"]').count(), 0, 'the owner can’t be removed');
  await mum.click('dialog.ha-sheet[open] [data-ha-close]'); await settle(mum);
  assert.equal(await mum.inputValue('#kh-member-email'), '');
  await mum.click('[data-act="sample"]');
  await settle(mum);

  const dad = await person('dad@example.com');
  await dad.locator('#main .ha-row-title', { hasText: 'Our home' }).waitFor();
  // the name reached Dad's phone too, and his changes now carry it
  await dad.locator('[data-act="person"][data-v="dad@example.com"] .ha-row-title', { hasText: 'Dad' }).waitFor();
  await go(dad, '#/items');
  await dad.locator('#kh-items-list .ha-row', { hasText: 'Kaya' }).waitFor();
  // dad uses up the kaya; mum's screen follows
  await go(mum, '#/items');
  await sub(mum, 'Kaya').filter({ hasText: '1 left' }).waitFor();
  await dad.locator('#kh-items-list a.ha-row', { hasText: 'Kaya' }).click(); await settle(dad);
  await dad.locator('[data-act="use"]').first().click(); await settle(dad);
  await sub(mum, 'Kaya').filter({ hasText: 'None left' }).waitFor();
  // and the history says who
  const kaya = await mum.evaluate(() => [...window.__kakihome.S.items.values()].find(i => i.name === 'Kaya').id);
  await go(mum, '#/item/' + kaya);
  await mum.locator('#main .ha-row-sub', { hasText: 'Dad' }).first().waitFor();

  // an outsider is not in any household and can't read or join this one
  const stranger = await person('stranger@example.com');
  await stranger.locator('[data-act="hh-create"]').waitFor();
  const hid = await mum.evaluate(() => window.__kakihome.S.household.id);
  const denied = await stranger.evaluate(async hid => {
    const F = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    const db = F.getFirestore();
    const out = [];
    for (const p of [['households', hid], ['households', hid, 'items', 'x']]) {
      try { await F.getDoc(F.doc(db, ...p)); out.push('read'); } catch (e) { out.push(e.code); }
    }
    try { await F.getDocs(F.collection(db, 'households', hid, 'items')); out.push('listed'); } catch (e) { out.push(e.code); }
    try { await F.updateDoc(F.doc(db, 'households', hid), { members: ['stranger@example.com', 'mum@example.com'] }); out.push('wrote'); } catch (e) { out.push(e.code); }
    try { await F.setDoc(F.doc(db, 'households', 'fake'), { name: 'x', owner: 'mum@example.com', members: ['mum@example.com', 'stranger@example.com'] }); out.push('wrote'); } catch (e) { out.push(e.code); }
    try { await F.setDoc(F.doc(db, 'households', hid, 'items', 'evil'), { id: 'evil', name: 'x' }); out.push('wrote'); } catch (e) { out.push(e.code); }
    try { await F.getDoc(F.doc(db, 'households', hid, 'settings', 'people')); out.push('read'); } catch (e) { out.push(e.code); }
    try { await F.setDoc(F.doc(db, 'households', hid, 'settings', 'people'), { id: 'people', names: { 'mum@example.com': 'x' } }); out.push('wrote'); } catch (e) { out.push(e.code); }
    return out;
  }, hid);
  assert.deepEqual(denied, Array(8).fill('permission-denied'), 'outsider denied: ' + denied.join(', '));
  // members' names: only the 'people' document, only id/names/updatedAt, at most 20 names
  const shapes = await dad.evaluate(async hid => {
    const F = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    const db = F.getFirestore(), out = [];
    const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`p${i}@example.com`, 'x']));
    for (const [id, data] of [['other', { id: 'other', names: {} }], ['people', { id: 'people', names: many }], ['people', { id: 'people', names: {}, extra: 1 }], ['people', { id: 'people', names: { 'dad@example.com': 'Dad' }, updatedAt: 'now' }]]) {
      try { await F.setDoc(F.doc(db, 'households', hid, 'settings', id), data); out.push('ok'); } catch (e) { out.push(e.code); }
    }
    return out;
  }, hid);
  assert.deepEqual(shapes, ['permission-denied', 'permission-denied', 'permission-denied', 'ok'], 'settings shapes: ' + shapes.join(', '));
  // dad can't remove the owner, or hand Kaki Home to himself
  const ownerKept = await dad.evaluate(async hid => {
    const F = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    const out = [];
    try { await F.updateDoc(F.doc(F.getFirestore(), 'households', hid), { members: ['dad@example.com'] }); out.push('wrote'); } catch (e) { out.push(e.code); }
    try { await F.updateDoc(F.doc(F.getFirestore(), 'households', hid), { owner: 'dad@example.com' }); out.push('wrote'); } catch (e) { out.push(e.code); }
    return out;
  }, hid);
  assert.deepEqual(ownerKept, ['permission-denied', 'permission-denied']);

  // ---- photos: thumbnails on items, photos in photos/{id}, size caps, old-style photos ----
  const rules = await mum.evaluate(async hid => {
    const F = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    const db = F.getFirestore(), d = (...p) => F.doc(db, 'households', hid, ...p);
    const out = {};
    const tryIt = async (name, fn) => { try { await fn(); out[name] = 'ok'; } catch (e) { out[name] = e.code; } };
    const item = (id, extra = {}) => ({ id, name: 'Rules ' + id, batches: [], ...extra });
    await tryIt('photo write', () => F.setDoc(d('photos', 'p1'), { id: 'p1', data: 'data:image/jpeg;base64,' + 'A'.repeat(100000), updatedAt: 'x' }));
    await tryIt('photo read', async () => { if (!(await F.getDoc(d('photos', 'p1'))).exists()) throw { code: 'missing' }; });
    await tryIt('photo over 150 KB', () => F.setDoc(d('photos', 'p2'), { id: 'p2', data: 'data:image/jpeg;base64,' + 'A'.repeat(153600) }));
    await tryIt('photo extra field', () => F.setDoc(d('photos', 'p3'), { id: 'p3', data: 'data:x', name: 'x' }));
    await tryIt('thumb 10 KB', () => F.setDoc(d('items', 't1'), item('t1', { thumb: 'data:image/jpeg;base64,' + 'A'.repeat(10000), hasPhoto: true })));
    await tryIt('thumb over 12 KB', () => F.setDoc(d('items', 't2'), item('t2', { thumb: 'A'.repeat(12289) })));
    await tryIt('new item with a photo', () => F.setDoc(d('items', 't3'), item('t3', { photo: 'data:image/jpeg;base64,AAAA' })));
    await tryIt('new item with an empty photo', () => F.setDoc(d('items', 't4'), item('t4', { photo: '' })));
    await tryIt('item gains a photo', () => F.setDoc(d('items', 't1'), item('t1', { photo: 'data:image/jpeg;base64,AAAA' })));
    await tryIt('item gains a photo (merge)', () => F.updateDoc(d('items', 't4'), { photo: 'data:image/jpeg;base64,AAAA' }));
    return out;
  }, hid);
  assert.deepEqual(rules, {
    'photo write': 'ok', 'photo read': 'ok', 'photo over 150 KB': 'permission-denied', 'photo extra field': 'permission-denied',
    'thumb 10 KB': 'ok', 'thumb over 12 KB': 'permission-denied', 'new item with a photo': 'permission-denied',
    'new item with an empty photo': 'ok', 'item gains a photo': 'permission-denied', 'item gains a photo (merge)': 'permission-denied',
  });
  // an old-style item (seeded past the rules; its picture can't be read, so the app leaves it alone): it can still be
  // edited with its photo unchanged, its photo can't be changed, and it can be removed
  const OLD = 'data:image/jpeg;base64,' + 'B'.repeat(200000);
  await admin.put(`households/${hid}/items/old1`, { id: 'old1', name: 'Old one', batches: [], photo: OLD });
  await settle(mum);
  const old = await mum.evaluate(async ([hid, OLD]) => {
    const F = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    const ref = F.doc(F.getFirestore(), 'households', hid, 'items', 'old1');
    const out = [];
    for (const data of [{ id: 'old1', name: 'Old one, renamed', batches: [], photo: OLD }, { id: 'old1', name: 'x', batches: [], photo: OLD + 'C' }, { id: 'old1', name: 'Old one, renamed', batches: [] }]) {
      try { await F.setDoc(ref, data); out.push('ok'); } catch (e) { out.push(e.code); }
    }
    return out;
  }, [hid, OLD]);
  assert.deepEqual(old, ['ok', 'permission-denied', 'ok'], 'old-style photo: kept, changed, removed');
  // an outsider can't read, list or write photos
  const outsider = await stranger.evaluate(async hid => {
    const F = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    const db = F.getFirestore(), out = [];
    try { await F.getDoc(F.doc(db, 'households', hid, 'photos', 'p1')); out.push('read'); } catch (e) { out.push(e.code); }
    try { await F.getDocs(F.collection(db, 'households', hid, 'photos')); out.push('listed'); } catch (e) { out.push(e.code); }
    try { await F.setDoc(F.doc(db, 'households', hid, 'photos', 'p9'), { id: 'p9', data: 'data:x' }); out.push('wrote'); } catch (e) { out.push(e.code); }
    return out;
  }, hid);
  assert.deepEqual(outsider, Array(3).fill('permission-denied'), 'outsider and photos: ' + outsider.join(', '));
  // the app moves a real old-style photo by itself: photo first, then the item keeps only a thumbnail
  const real = await mum.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 480; c.height = 360; const g = c.getContext('2d');
    g.fillStyle = '#c33'; g.fillRect(0, 0, 480, 360); g.fillStyle = '#fff'; g.fillRect(60, 60, 200, 120);
    return c.toDataURL('image/jpeg', 0.72);
  });
  await admin.put(`households/${hid}/items/old2`, { id: 'old2', name: 'Old photo', batches: [], photo: real, createdBy: 'mum' });
  let moved = null;
  for (let i = 0; i < 40 && !(moved && moved.hasPhoto && !('photo' in moved)); i++) { await settle(mum); moved = await admin.get(`households/${hid}/items/old2`); }
  assert.ok(moved && moved.hasPhoto === true && !('photo' in moved) && moved.thumb.startsWith('data:image/jpeg') && moved.thumb.length <= 12288, 'the old item now holds a thumbnail only');
  assert.equal(moved.name, 'Old photo');
  assert.equal((await admin.get(`households/${hid}/photos/old2`))?.data, real, 'its photo moved to photos/old2 unchanged');
  // and the family sees it: dad's list shows the thumbnail, his item screen the photo
  await go(dad, '#/items');
  await dad.waitForFunction(t => [...document.querySelectorAll('#kh-items-list img.ha-row-thumb')].some(i => i.getAttribute('src') === t), moved.thumb);
  await go(dad, '#/item/old2');
  await dad.waitForFunction(d => document.querySelector('#kh-hero')?.src === d, real);
  // deleting an item in the app deletes its photo
  await dad.click('[data-act="delete"]'); await settle(dad); await settle(dad);
  assert.equal(await admin.get(`households/${hid}/photos/old2`), null, 'deleting the item deleted its photo');


  // ---- names never hide anyone (owner report: after saving a name "the list of my family members disappeared") ----
  // three members on three phones each name themselves; after every save and after a reload each phone still lists
  // all three, with the right names
  const listed = p => p.$$eval('#main [data-act="person"]', bs => bs.map(b => b.dataset.v));
  const everyone = ['mum@example.com', 'dad@example.com', 'gran@example.com'];
  await go(mum, '#/settings');
  await mum.fill('#kh-member-email', 'Gran@Example.com');
  await mum.click('#kh-member-add button[type=submit]');
  await mum.locator('#main [data-act="person"][data-v="gran@example.com"]').waitFor();
  const gran = await person('gran@example.com');
  await gran.locator('#main [data-act="person"][data-v="mum@example.com"]').waitFor();
  const nameSelf = async (p, email, n) => {
    await p.click(`#main [data-act="person"][data-v="${email}"]`); await settle(p);
    await p.fill('#kh-person-name', n);
    await p.locator('dialog.ha-sheet[open] button[type=submit]').click(); await settle(p);
    await p.locator('.ha-toast', { hasText: `Saved: ${n}` }).waitFor();
  };
  await nameSelf(mum, 'mum@example.com', 'Jun');
  assert.deepEqual(await listed(mum), everyone, 'mum still lists everyone right after saving her own name');
  await go(dad, '#/settings');
  await nameSelf(dad, 'dad@example.com', 'Dad');
  await nameSelf(gran, 'gran@example.com', 'Gran');
  const rowsOf = p => p.$$eval('#main [data-act="person"]', bs => bs.map(b => `${b.dataset.v}=${b.querySelector('.ha-row-title').textContent}`));
  for (const [who, p] of [['mum', mum], ['dad', dad], ['gran', gran]]) {
    await go(p, '#/settings');
    await p.waitForFunction(() => document.querySelectorAll('#main [data-act="person"][data-v="gran@example.com"] .ha-row-title')[0]?.textContent === 'Gran');
    assert.deepEqual(await rowsOf(p), ['mum@example.com=Jun', 'dad@example.com=Dad', 'gran@example.com=Gran'], `${who} lists everyone with names`);
    await p.reload();
    await p.waitForFunction(() => window.__kakihome?.S.household?.members?.length === 3);
    await go(p, '#/settings');
    await p.waitForFunction(() => document.querySelector('#main [data-act="person"][data-v="gran@example.com"] .ha-row-title')?.textContent === 'Gran');
    assert.deepEqual(await listed(p), everyone, `${who} lists everyone after a reload`);
  }
  // a second, one-person pantry for Mum (what a second "Start our household" leaves behind) that sorts first must
  // not hide the family: the phone keeps its own, and starting a pantry again opens the existing one
  await admin.put('households/0000stray', { name: 'Our home', owner: 'mum@example.com', members: ['mum@example.com'] });
  await mum.reload();
  await mum.waitForFunction(() => window.__kakihome?.S.household);
  await go(mum, '#/settings');
  assert.equal(await mum.evaluate(() => window.__kakihome.S.household.id), hid, 'a stray pantry did not take over');
  assert.deepEqual(await listed(mum), everyone, 'mum still lists everyone with a stray pantry around');
  await mum.evaluate(() => { localStorage.removeItem('kakihome:household'); });
  await mum.reload();
  await mum.waitForFunction(() => window.__kakihome?.S.household);
  assert.equal(await mum.evaluate(() => window.__kakihome.S.household.id), hid, 'with nothing remembered, the pantry with the most people wins');
  await admin.del('households/0000stray');

  if (process.env.SHOTS) { await go(mum, '#/settings'); await mum.screenshot({ path: process.env.SHOTS + '/m06-family-after-names.png' }); }

  // ---- merging two pantries for one email (owner: "merge duplicate emails into 1 pantry") ----
  const KINDS5 = ['items', 'events', 'shop', 'photos'];
  const seedPantry = async (id, owner, members, tag, { items = 2, extra = {} } = {}) => {
    await admin.put(`households/${id}`, { name: 'Our home', owner, members, createdAt: '2026-10-16T00:00:00.000Z' });
    for (let i = 0; i < items; i++) {
      await admin.put(`households/${id}/items/${tag}i${i}`, { id: `${tag}i${i}`, name: `${tag} item ${i}`, batches: [], hasPhoto: true, thumb: 'data:image/jpeg;base64,AAAA', ...extra });
      await admin.put(`households/${id}/photos/${tag}i${i}`, { id: `${tag}i${i}`, data: 'data:image/jpeg;base64,BBBB', updatedAt: 'x' });
    }
    await admin.put(`households/${id}/events/${tag}e1`, { id: `${tag}e1`, itemId: `${tag}i0`, type: 'add', at: '2026-10-16T00:00:00.000Z' });
    await admin.put(`households/${id}/shop/${tag}s1`, { id: `${tag}s1`, text: `${tag} milk` });
    await admin.put(`households/${id}/settings/people`, { id: 'people', names: Object.fromEntries(members.map(m => [m, tag + ':' + m.split('@')[0]])), updatedAt: 'x' });
  };
  // two pantries, both started by twin: the bigger one is kept, everything of the other moves in
  await seedPantry('dupA', 'twin@example.com', ['twin@example.com', 'pal1@example.com'], 'A');
  await seedPantry('dupB', 'twin@example.com', ['twin@example.com', 'pal2@example.com', 'pal3@example.com'], 'B', { items: 3 });
  const twin = await person('twin@example.com');
  await twin.locator('#main [data-act="merge-open"]').waitFor();
  assert.equal(await twin.evaluate(() => window.__kakihome.S.household.id), 'dupB', 'the bigger one opens');
  await go(twin, '#/');
  await twin.locator('a.kh-alert', { hasText: 'more than one household' }).waitFor();
  await go(twin, '#/settings');
  await twin.click('[data-act="merge-open"]'); await settle(twin);
  const sheet = twin.locator('dialog.ha-sheet[open]');
  assert.equal(await sheet.locator('input[name="kh-keep"]').count(), 2);
  assert.equal(await sheet.locator('input[name="kh-keep"]:checked').getAttribute('value'), 'dupB', 'most people preselected');
  assert.match(await sheet.textContent(), /3 people/);
  assert.match(await sheet.textContent(), /2 people/);
  if (process.env.SHOTS) await twin.screenshot({ path: process.env.SHOTS + '/m07-merge.png' });
  await sheet.locator('[data-pm="go"]').click(); await settle(twin);
  await twin.locator('dialog[open] button', { hasText: /^Merge$/ }).click();
  await twin.locator('.ha-toast', { hasText: 'Merged' }).waitFor();
  await settle(twin);
  assert.equal(await admin.get('households/dupA'), null, 'the other household is gone');
  for (const k of [...KINDS5, 'settings']) assert.equal((await admin.list(`households/dupA/${k}`)).length, 0, 'dupA ' + k + ' deleted');
  const kept = await admin.get('households/dupB');
  assert.deepEqual(kept.members, ['twin@example.com', 'pal2@example.com', 'pal3@example.com', 'pal1@example.com'], 'members joined');
  assert.equal(kept.owner, 'twin@example.com');
  const counts = {};
  for (const k of KINDS5) counts[k] = (await admin.list(`households/dupB/${k}`)).length;
  assert.deepEqual(counts, { items: 5, events: 2, shop: 2, photos: 5 }, 'everything of both is in the kept pantry');
  const names = (await admin.get('households/dupB/settings/people')).names;
  assert.deepEqual(names, { 'twin@example.com': 'B:twin', 'pal2@example.com': 'B:pal2', 'pal3@example.com': 'B:pal3', 'pal1@example.com': 'A:pal1' }, 'names joined, the kept pantry’s names win');
  assert.equal(await twin.evaluate(() => window.__kakihome.S.allHouseholds.length), 1);
  assert.equal(await twin.locator('[data-act="merge-open"]').count(), 0, 'the card is gone');
  assert.equal(await twin.evaluate(() => [...window.__kakihome.S.items.values()].length), 5, 'the app shows all five items');
  await twin.reload(); await twin.waitForFunction(() => window.__kakihome?.S.household?.id === 'dupB');
  assert.equal(await twin.evaluate(() => window.__kakihome.S.allHouseholds.length), 1);

  // someone else's pantry can't be merged away by a member (and the rules say the same)
  await seedPantry('dupC', 'boss@example.com', ['boss@example.com', 'twin2@example.com'], 'C');
  await seedPantry('dupD', 'twin2@example.com', ['twin2@example.com'], 'D');
  const twin2 = await person('twin2@example.com');
  await twin2.locator('#main [data-act="merge-open"]').waitFor();
  await twin2.click('[data-act="merge-open"]'); await settle(twin2);
  const sh2 = twin2.locator('dialog.ha-sheet[open]');
  await sh2.locator('input[name="kh-keep"][value="dupD"]').check(); await settle(twin2);
  assert.match(await sh2.textContent(), /Only whoever started a household can merge it away\. Ask C:boss to merge them/);
  assert.equal(await sh2.locator('[data-pm="go"]').isDisabled(), true);
  const denyDelete = await twin2.evaluate(async () => {
    const F = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    try { await F.deleteDoc(F.doc(F.getFirestore(), 'households', 'dupC')); return 'deleted'; } catch (e) { return e.code; }
  });
  assert.equal(denyDelete, 'permission-denied', 'a member who isn’t the owner can’t delete the household');
  assert.ok(await admin.get('households/dupC'), 'still there');
  await sh2.locator('[data-ha-close]').click(); await settle(twin2);

  // a copy that fails deletes nothing: an item the rules refuse (thumbnail over 12 KB) stops the merge
  await seedPantry('dupE', 'twin3@example.com', ['twin3@example.com'], 'E', { extra: { thumb: 'A'.repeat(13000) } });
  await seedPantry('dupF', 'twin3@example.com', ['twin3@example.com', 'x1@example.com'], 'F');
  const twin3 = await person('twin3@example.com');
  await twin3.locator('#main [data-act="merge-open"]').waitFor();
  await twin3.click('[data-act="merge-open"]'); await settle(twin3);
  await twin3.locator('dialog.ha-sheet[open] [data-pm="go"]').click(); await settle(twin3);
  await twin3.locator('dialog[open] button', { hasText: /^Merge$/ }).click();
  await twin3.locator('#kh-merge-msg', { hasText: 'Nothing was lost' }).waitFor();
  assert.ok(await admin.get('households/dupE'), 'the other pantry is still there');
  assert.equal((await admin.list('households/dupE/items')).length, 2, 'and its items');
  assert.equal((await admin.list('households/dupE/photos')).length, 2, 'and its photos');
  assert.ok(await admin.get('households/dupF'));

  // ---- no signal: "can't tell" is never "no pantry", and nothing is created offline ----
  const owned = async email => (await admin.list('households')).filter(h => h.owner === email).length;
  await admin.put('households/offH', { name: 'Our home', owner: 'off@example.com', members: ['off@example.com'], createdAt: '2026-10-16T00:00:00.000Z' });
  const offCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await offCtx.route(/:8085\//, r => r.abort());   // the family pantry's server can't be reached
  const off = await offCtx.newPage();
  off.on('pageerror', e => errors.push('off: ' + e.message));
  await off.goto(url + '#/settings');
  await off.waitForFunction(() => window.__kakihome?.signIn);
  await off.evaluate(e => window.__kakihome.signIn(e), 'off@example.com');
  await off.locator('#main', { hasText: "Can’t check right now" }).waitFor({ timeout: 60000 });
  assert.equal(await off.locator('[data-act="hh-create"]').count(), 0, 'offline: no Start our household');
  assert.equal(await off.locator('[data-act="hh-check"]').count(), 1, 'a Try again instead');
  assert.equal(await owned('off@example.com'), 1, 'nothing was created');
  await off.click('[data-act="hh-check"]');
  await off.locator('.ha-toast').waitFor();
  assert.equal(await off.locator('[data-act="hh-create"]').count(), 0, 'still offline: still no Start');
  await offCtx.unroute(/:8085\//);
  await off.click('[data-act="hh-check"]');
  await off.waitForFunction(() => window.__kakihome.S.household?.id === 'offH', null, { timeout: 30000 });
  assert.equal(await owned('off@example.com'), 1, 'online again: the existing pantry opened, no second one');
  // a double tap on Start our household makes one pantry, not two
  const quick = await person('quick@example.com');
  await quick.locator('[data-act="hh-create"]').dblclick();
  await quick.locator('#main .ha-row-title', { hasText: 'Our home' }).waitFor();
  await settle(quick);
  assert.equal(await owned('quick@example.com'), 1, 'one household after a double tap');

  // mum signs out: back to this phone's own (empty) list
  await go(mum, '#/settings');
  await mum.click('[data-act="signout"]');
  await mum.locator('[data-act="signin"]').waitFor();
  await go(mum, '#/');
  assert.equal(await mum.locator('.ha-large-sub').textContent(), 'Saved on this phone');
  assert.deepEqual(errors, []);
  console.log('kakihome sync e2e: ok');
} finally {
  await browser.close();
  srv.close();
}
