// Household sharing against the local Firebase emulators (fake accounts, demo-kakihome project; never the live one):
// one person starts Kaki Home and adds another, both see each other's changes, an outsider sees nothing, photos (members
// only, size caps, old-style photos moved by the app), names never hide anyone, merging duplicate households, no signal,
// the owner can't be removed, and signing out goes back to the phone's own list.
// Every test seeds its own households (through the emulator's admin door) and uses its own made-up emails (uid), so the
// tests run in any order and side by side. Run: npx playwright test sync
import { test, expect } from './fixtures.mjs';

const FSJS = 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
const HOME = '2026-10-16T00:00:00.000Z';

// sign in as a made-up Google account, once Auth has settled its first state (a sign-in sent while it is still starting
// up can be overwritten by it, which no person tapping a button could cause)
async function signInAs(p, email) {
  await p.waitForFunction(() => window.__kakihome?.signIn);
  await p.evaluate(async e => { const { auth } = await window.__kakihome.S.cloud.sdk(); await auth.authStateReady(); await window.__kakihome.signIn(e); }, email);
}
// a phone signed in as a made-up Google account on Settings (with hid: waits until that household has opened)
async function person(phone, name, email, hid) {
  const p = await phone(name, { url: '/kakihome/?emulator#/settings' });
  await signInAs(p, email);
  await expect(p.locator('#main')).toContainText(email);
  if (hid) await expect.poll(() => p.evaluate(() => window.__kakihome.S.household?.id)).toBe(hid);
  return p;
}
const go = (p, h) => p.evaluate(x => { location.hash = x; }, h);
const sub = (p, name) => p.locator('#kh-items-list .ha-row', { hasText: name }).locator('.ha-row-sub');
const sheetOpen = p => p.locator('dialog.ha-sheet[open]');
const personRow = (p, email) => p.locator(`#main [data-act="person"][data-v="${email}"]`);
const household = (fsAdmin, id, owner, members) => fsAdmin.put(`households/${id}`, { name: 'Our home', owner, members, createdAt: HOME });
// runs fn(F, ...args) in the page with Firestore's browser library, signed in as that phone's account
const inPage = (p, fn, ...args) => p.evaluate(`(async () => { const F = await import(${JSON.stringify(FSJS)}); return (${fn.toString()})(F, ...${JSON.stringify(args)}); })()`);

test('start a household, add someone by email, name them, invite them; both phones follow each other', async ({ phone, uid }) => {
  const mumE = `mum-${uid}@example.com`, dadE = `dad-${uid}@example.com`;
  const mum = await person(phone, 'mum', mumE);
  await mum.click('[data-act="hh-create"]');
  await expect(mum.locator('#main .ha-row-title', { hasText: 'Our home' })).toBeVisible();
  await mum.fill('#kh-member-email', dadE.replace('dad-', 'Dad-').replace('example', 'Example'));
  await mum.click('#kh-member-add button[type=submit]');
  await expect(mum.locator('#main .ha-row-title', { hasText: dadE })).toBeVisible();
  // an invite from Mum's own mail app: the toast offers it, and Dad's card keeps it for later
  await expect(mum.locator('.ha-toast-action', { hasText: 'Email invite' })).toBeVisible();
  await mum.click(`[data-act="person"][data-v="${dadE}"]`);
  const card = sheetOpen(mum);
  await expect(card.locator('.ha-sheet-title')).toHaveText('Household member');
  await expect(card.locator('[data-act="member-del"]'), 'Stop sharing on someone else').toHaveCount(1);
  const invite = await card.locator('a', { hasText: 'Email an invite' }).getAttribute('href');
  expect(invite).toMatch(new RegExp(`^mailto:${encodeURIComponent(dadE).replace(/\./g, '\\.')}\\?subject=Our%20household%20on%20Kaki%20Home&body=`));
  expect(decodeURIComponent(invite)).toContain(`Continue with Google (or Use email instead), using this email address (${dadE})`);
  // name him: the list shows the name with the email underneath
  await mum.fill('#kh-person-name', '  Dad  ');
  await card.locator('button[type=submit]').click();
  await expect(mum.locator(`[data-act="person"][data-v="${dadE}"] .ha-row-title`)).toHaveText('Dad');
  await expect(mum.locator(`[data-act="person"][data-v="${dadE}"] .ha-row-sub`)).toContainText(dadE);
  // the owner's own card: no Stop sharing
  await mum.click(`[data-act="person"][data-v="${mumE}"]`);
  await expect(sheetOpen(mum).locator('.ha-sheet-title')).toBeVisible();
  await expect(sheetOpen(mum).locator('[data-act="member-del"]'), 'the owner can’t be removed').toHaveCount(0);
  await mum.click('dialog.ha-sheet[open] [data-ha-close]');
  await expect(sheetOpen(mum)).toHaveCount(0);
  await expect(mum.locator('#kh-member-email')).toHaveValue('');
  await mum.click('[data-act="sample"]');
  await expect(mum.locator('.ha-toast', { hasText: 'sample items' })).toBeVisible();

  const dad = await person(phone, 'dad', dadE);
  await expect(dad.locator('#main .ha-row-title', { hasText: 'Our home' })).toBeVisible();
  // the name reached Dad's phone too
  await expect(dad.locator(`[data-act="person"][data-v="${dadE}"] .ha-row-title`)).toHaveText('Dad');
  await go(dad, '#/items');
  await expect(dad.locator('#kh-items-list .ha-row', { hasText: 'Kaya' })).toBeVisible();
  // dad uses up the kaya; mum's screen follows
  await go(mum, '#/items');
  await expect(sub(mum, 'Kaya')).toContainText('1 left');
  await dad.locator('#kh-items-list a.ha-row', { hasText: 'Kaya' }).click();
  await dad.locator('[data-act="use"]').first().click();
  await expect(sub(mum, 'Kaya')).toContainText('None left');
  // and the history says who
  const kaya = await mum.evaluate(() => [...window.__kakihome.S.items.values()].find(i => i.name === 'Kaya').id);
  await go(mum, '#/item/' + kaya);
  await expect(mum.locator('#main .ha-row-sub', { hasText: 'Dad' }).first()).toBeVisible();
});

test('an outsider is denied everything; member names have a fixed shape; a member can’t remove the owner', async ({ phone, fsAdmin, uid }) => {
  const mumE = `mum-${uid}@example.com`, dadE = `dad-${uid}@example.com`, strE = `stranger-${uid}@example.com`, hid = `hh-${uid}`;
  await household(fsAdmin, hid, mumE, [mumE, dadE]);
  const dad = await person(phone, 'dad', dadE, hid);
  // an outsider is not in any household and can't read or join this one
  const stranger = await person(phone, 'stranger', strE);
  await expect(stranger.locator('[data-act="hh-create"]')).toBeVisible();
  const denied = await inPage(stranger, async (F, hid, mumE, strE, fake) => {
    const db = F.getFirestore(), out = [];
    const tryIt = async fn => { try { await fn(); return 'wrote'; } catch (e) { return e.code; } };
    for (const p of [['households', hid], ['households', hid, 'items', 'x']]) out.push(await F.getDoc(F.doc(db, ...p)).then(() => 'read', e => e.code));
    out.push(await F.getDocs(F.collection(db, 'households', hid, 'items')).then(() => 'listed', e => e.code));
    out.push(await tryIt(() => F.updateDoc(F.doc(db, 'households', hid), { members: [strE, mumE] })));
    out.push(await tryIt(() => F.setDoc(F.doc(db, 'households', fake), { name: 'x', owner: mumE, members: [mumE, strE] })));
    out.push(await tryIt(() => F.setDoc(F.doc(db, 'households', hid, 'items', 'evil'), { id: 'evil', name: 'x' })));
    out.push(await F.getDoc(F.doc(db, 'households', hid, 'settings', 'people')).then(() => 'read', e => e.code));
    out.push(await tryIt(() => F.setDoc(F.doc(db, 'households', hid, 'settings', 'people'), { id: 'people', names: { [mumE]: 'x' } })));
    return out;
  }, hid, mumE, strE, `fake-${uid}`);
  expect(denied, 'outsider denied').toEqual(Array(8).fill('permission-denied'));
  // members' names: only the 'people' document, only id/names/updatedAt, at most 20 names
  const shapes = await inPage(dad, async (F, hid, dadE) => {
    const db = F.getFirestore(), out = [];
    const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`p${i}@example.com`, 'x']));
    for (const [id, data] of [['other', { id: 'other', names: {} }], ['people', { id: 'people', names: many }], ['people', { id: 'people', names: {}, extra: 1 }], ['people', { id: 'people', names: { [dadE]: 'Dad' }, updatedAt: 'now' }]]) {
      try { await F.setDoc(F.doc(db, 'households', hid, 'settings', id), data); out.push('ok'); } catch (e) { out.push(e.code); }
    }
    return out;
  }, hid, dadE);
  expect(shapes, 'settings shapes').toEqual(['permission-denied', 'permission-denied', 'permission-denied', 'ok']);
  // dad can't remove the owner, or hand Kaki Home to himself
  const ownerKept = await inPage(dad, async (F, hid, dadE) => {
    const out = [], ref = F.doc(F.getFirestore(), 'households', hid);
    try { await F.updateDoc(ref, { members: [dadE] }); out.push('wrote'); } catch (e) { out.push(e.code); }
    try { await F.updateDoc(ref, { owner: dadE }); out.push('wrote'); } catch (e) { out.push(e.code); }
    return out;
  }, hid, dadE);
  expect(ownerKept).toEqual(['permission-denied', 'permission-denied']);
});

test('photo rules: thumbnails, photos in photos/{id}, size caps, old-style items; outsiders see no photos', async ({ phone, fsAdmin, uid }) => {
  const mumE = `mum-${uid}@example.com`, strE = `stranger-${uid}@example.com`, hid = `hh-${uid}`;
  await household(fsAdmin, hid, mumE, [mumE]);
  const mum = await person(phone, 'mum', mumE, hid);
  const rules = await inPage(mum, async (F, hid) => {
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
  expect(rules).toEqual({
    'photo write': 'ok', 'photo read': 'ok', 'photo over 150 KB': 'permission-denied', 'photo extra field': 'permission-denied',
    'thumb 10 KB': 'ok', 'thumb over 12 KB': 'permission-denied', 'new item with a photo': 'permission-denied',
    'new item with an empty photo': 'ok', 'item gains a photo': 'permission-denied', 'item gains a photo (merge)': 'permission-denied',
  });
  // an old-style item (seeded past the rules; its picture can't be read, so the app leaves it alone): it can still be
  // edited with its photo unchanged, its photo can't be changed, and it can be removed
  const OLD = 'data:image/jpeg;base64,' + 'B'.repeat(200000);
  await fsAdmin.put(`households/${hid}/items/old1`, { id: 'old1', name: 'Old one', batches: [], photo: OLD });
  await expect.poll(() => mum.evaluate(() => window.__kakihome.S.items.has('old1')), { message: 'the app has the old item' }).toBe(true);
  const old = await inPage(mum, async (F, hid, OLD) => {
    const ref = F.doc(F.getFirestore(), 'households', hid, 'items', 'old1');
    const out = [];
    for (const data of [{ id: 'old1', name: 'Old one, renamed', batches: [], photo: OLD }, { id: 'old1', name: 'x', batches: [], photo: OLD + 'C' }, { id: 'old1', name: 'Old one, renamed', batches: [] }]) {
      try { await F.setDoc(ref, data); out.push('ok'); } catch (e) { out.push(e.code); }
    }
    return out;
  }, hid, OLD);
  expect(old, 'old-style photo: kept, changed, removed').toEqual(['ok', 'permission-denied', 'ok']);
  // an outsider can't read, list or write photos
  const stranger = await person(phone, 'stranger', strE);
  await expect(stranger.locator('[data-act="hh-create"]')).toBeVisible();
  const outsider = await inPage(stranger, async (F, hid) => {
    const db = F.getFirestore(), out = [];
    try { await F.getDoc(F.doc(db, 'households', hid, 'photos', 'p1')); out.push('read'); } catch (e) { out.push(e.code); }
    try { await F.getDocs(F.collection(db, 'households', hid, 'photos')); out.push('listed'); } catch (e) { out.push(e.code); }
    try { await F.setDoc(F.doc(db, 'households', hid, 'photos', 'p9'), { id: 'p9', data: 'data:x' }); out.push('wrote'); } catch (e) { out.push(e.code); }
    return out;
  }, hid);
  expect(outsider, 'outsider and photos').toEqual(Array(3).fill('permission-denied'));
});

test('the app moves a real old-style photo by itself, the household sees it, deleting the item deletes its photo', async ({ phone, fsAdmin, uid }) => {
  const mumE = `mum-${uid}@example.com`, dadE = `dad-${uid}@example.com`, hid = `hh-${uid}`;
  await household(fsAdmin, hid, mumE, [mumE, dadE]);
  const mum = await person(phone, 'mum', mumE, hid);
  const dad = await person(phone, 'dad', dadE, hid);
  const real = await mum.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 480; c.height = 360; const g = c.getContext('2d');
    g.fillStyle = '#c33'; g.fillRect(0, 0, 480, 360); g.fillStyle = '#fff'; g.fillRect(60, 60, 200, 120);
    return c.toDataURL('image/jpeg', 0.72);
  });
  await fsAdmin.put(`households/${hid}/items/old2`, { id: 'old2', name: 'Old photo', batches: [], photo: real, createdBy: 'mum' });
  await expect.poll(async () => { const m = await fsAdmin.get(`households/${hid}/items/old2`); return !!m && m.hasPhoto === true && !('photo' in m); },
    { message: 'the old item is moved', timeout: 30_000 }).toBe(true);
  const moved = await fsAdmin.get(`households/${hid}/items/old2`);
  expect(moved.thumb.startsWith('data:image/jpeg') && moved.thumb.length <= 12288, 'the old item now holds a thumbnail only').toBe(true);
  expect(moved.name).toBe('Old photo');
  expect((await fsAdmin.get(`households/${hid}/photos/old2`))?.data, 'its photo moved to photos/old2 unchanged').toBe(real);
  // and the household sees it: dad's list shows the thumbnail, his item screen the photo
  await go(dad, '#/items');
  await expect(dad.locator('#kh-items-list a.ha-row', { hasText: 'Old photo' }).locator('img.ha-row-thumb')).toHaveAttribute('src', moved.thumb);
  await go(dad, '#/item/old2');
  await expect(dad.locator('#kh-hero')).toHaveAttribute('src', real);
  // deleting an item in the app deletes its photo
  await dad.click('[data-act="delete"]');
  await expect.poll(() => fsAdmin.get(`households/${hid}/photos/old2`), { message: 'deleting the item deleted its photo' }).toBeNull();
});

// owner report: after saving a name "the list of my family members disappeared": three members on three phones each name
// themselves; after every save and after a reload each phone still lists all three, with the right names
test('names never hide anyone', async ({ phone, fsAdmin, uid }) => {
  const mumE = `mum-${uid}@example.com`, dadE = `dad-${uid}@example.com`, granE = `gran-${uid}@example.com`, hid = `hh-${uid}`;
  const everyone = [mumE, dadE, granE];
  await household(fsAdmin, hid, mumE, [mumE, dadE]);
  const mum = await person(phone, 'mum', mumE, hid);
  const dad = await person(phone, 'dad', dadE, hid);
  const listed = p => p.$$eval('#main [data-act="person"]', bs => bs.map(b => b.dataset.v));
  const rowsOf = p => p.$$eval('#main [data-act="person"]', bs => bs.map(b => `${b.dataset.v}=${b.querySelector('.ha-row-title').textContent}`));
  await mum.fill('#kh-member-email', granE);
  await mum.click('#kh-member-add button[type=submit]');
  await expect(personRow(mum, granE)).toBeVisible();
  const gran = await person(phone, 'gran', granE, hid);
  await expect(personRow(gran, mumE)).toBeVisible();
  const nameSelf = async (p, email, n) => {
    await personRow(p, email).click();
    await expect(sheetOpen(p)).toBeVisible();
    await p.fill('#kh-person-name', n);
    await sheetOpen(p).locator('button[type=submit]').click();
    await expect(p.locator('.ha-toast', { hasText: `Saved: ${n}` })).toBeVisible();
  };
  await nameSelf(mum, mumE, 'Jun');
  expect(await listed(mum), 'mum still lists everyone right after saving her own name').toEqual(everyone);
  await go(dad, '#/settings');
  await nameSelf(dad, dadE, 'Dad');
  await nameSelf(gran, granE, 'Gran');
  for (const [who, p] of [['mum', mum], ['dad', dad], ['gran', gran]]) {
    await go(p, '#/settings');
    await expect(personRow(p, granE).locator('.ha-row-title')).toHaveText('Gran');
    await expect.poll(() => rowsOf(p), { message: `${who} lists everyone with names` }).toEqual([`${mumE}=Jun`, `${dadE}=Dad`, `${granE}=Gran`]);
    await p.reload();
    await p.waitForFunction(() => window.__kakihome?.S.household?.members?.length === 3);
    await go(p, '#/settings');
    await expect(personRow(p, granE).locator('.ha-row-title')).toHaveText('Gran');
    expect(await listed(p), `${who} lists everyone after a reload`).toEqual(everyone);
  }
  // a second, one-person household for Mum (what a second "Start our household" leaves behind) that sorts first must
  // not hide the household: the phone keeps its own, and starting again opens the existing one
  await fsAdmin.put(`households/0000stray-${uid}`, { name: 'Our home', owner: mumE, members: [mumE] });
  await mum.reload();
  await mum.waitForFunction(() => window.__kakihome?.S.household);
  await go(mum, '#/settings');
  expect(await mum.evaluate(() => window.__kakihome.S.household.id), 'a stray household did not take over').toBe(hid);
  await expect(personRow(mum, granE)).toBeVisible();
  expect(await listed(mum), 'mum still lists everyone with a stray household around').toEqual(everyone);
  await mum.evaluate(() => { localStorage.removeItem('kakihome:household'); });
  await mum.reload();
  await mum.waitForFunction(() => window.__kakihome?.S.household);
  expect(await mum.evaluate(() => window.__kakihome.S.household.id), 'with nothing remembered, the household with the most people wins').toBe(hid);
});

// ---- merging two households for one email (owner: "merge duplicate emails into 1 household") ----
const KINDS5 = ['items', 'events', 'shop', 'photos'];
async function seedHousehold(fsAdmin, id, owner, members, tag, { items = 2, extra = {} } = {}) {
  await fsAdmin.put(`households/${id}`, { name: 'Our home', owner, members, createdAt: HOME });
  for (let i = 0; i < items; i++) {
    await fsAdmin.put(`households/${id}/items/${tag}i${i}`, { id: `${tag}i${i}`, name: `${tag} item ${i}`, batches: [], hasPhoto: true, thumb: 'data:image/jpeg;base64,AAAA', ...extra });
    await fsAdmin.put(`households/${id}/photos/${tag}i${i}`, { id: `${tag}i${i}`, data: 'data:image/jpeg;base64,BBBB', updatedAt: 'x' });
  }
  await fsAdmin.put(`households/${id}/events/${tag}e1`, { id: `${tag}e1`, itemId: `${tag}i0`, type: 'add', at: HOME });
  await fsAdmin.put(`households/${id}/shop/${tag}s1`, { id: `${tag}s1`, text: `${tag} milk` });
  await fsAdmin.put(`households/${id}/settings/people`, { id: 'people', names: Object.fromEntries(members.map(m => [m, tag + ':' + m.split('@')[0].replace(/-[a-z0-9]+$/, '')])), updatedAt: 'x' });
}

test('merge two households of one email: the bigger one is kept, everything of the other moves in', async ({ phone, fsAdmin, uid }) => {
  const twinE = `twin-${uid}@example.com`, p1 = `pal1-${uid}@example.com`, p2 = `pal2-${uid}@example.com`, p3 = `pal3-${uid}@example.com`;
  const A = `dupA-${uid}`, B = `dupB-${uid}`;
  await seedHousehold(fsAdmin, A, twinE, [twinE, p1], 'A');
  await seedHousehold(fsAdmin, B, twinE, [twinE, p2, p3], 'B', { items: 3 });
  const twin = await person(phone, 'twin', twinE);
  await expect(twin.locator('#main [data-act="merge-open"]')).toBeVisible();
  expect(await twin.evaluate(() => window.__kakihome.S.household.id), 'the bigger one opens').toBe(B);
  await go(twin, '#/');
  await expect(twin.locator('a.kh-alert', { hasText: 'more than one household' })).toBeVisible();
  await go(twin, '#/settings');
  await twin.click('[data-act="merge-open"]');
  const sheet = sheetOpen(twin);
  await expect(sheet.locator('input[name="kh-keep"]')).toHaveCount(2);
  await expect(sheet.locator('input[name="kh-keep"]:checked'), 'most people preselected').toHaveAttribute('value', B);
  await expect(sheet).toContainText('3 people');
  await expect(sheet).toContainText('2 people');
  await sheet.locator('[data-pm="go"]').click();
  await twin.locator('dialog[open] button', { hasText: /^Merge$/ }).click();
  await expect(twin.locator('.ha-toast', { hasText: 'Merged' })).toBeVisible();
  await expect.poll(() => fsAdmin.get(`households/${A}`), { message: 'the other household is gone' }).toBeNull();
  for (const k of [...KINDS5, 'settings']) await expect.poll(async () => (await fsAdmin.list(`households/${A}/${k}`)).length, { message: 'A ' + k + ' deleted' }).toBe(0);
  const kept = await fsAdmin.get(`households/${B}`);
  expect(kept.members, 'members joined').toEqual([twinE, p2, p3, p1]);
  expect(kept.owner).toBe(twinE);
  const counts = {};
  for (const k of KINDS5) counts[k] = (await fsAdmin.list(`households/${B}/${k}`)).length;
  expect(counts, 'everything of both is in the kept household').toEqual({ items: 5, events: 2, shop: 2, photos: 5 });
  const names = (await fsAdmin.get(`households/${B}/settings/people`)).names;
  expect(names, 'names joined, the kept household’s names win').toEqual({ [twinE]: 'B:twin', [p2]: 'B:pal2', [p3]: 'B:pal3', [p1]: 'A:pal1' });
  await expect.poll(() => twin.evaluate(() => window.__kakihome.S.allHouseholds.length)).toBe(1);
  await expect(twin.locator('[data-act="merge-open"]'), 'the card is gone').toHaveCount(0);
  await expect.poll(() => twin.evaluate(() => [...window.__kakihome.S.items.values()].length), { message: 'the app shows all five items' }).toBe(5);
  await twin.reload();
  await twin.waitForFunction(h => window.__kakihome?.S.household?.id === h, B);
  expect(await twin.evaluate(() => window.__kakihome.S.allHouseholds.length)).toBe(1);
});

test('someone else’s household can’t be merged away by a member (and the rules say the same)', async ({ phone, fsAdmin, uid }) => {
  const bossE = `boss-${uid}@example.com`, twinE = `twin2-${uid}@example.com`, C = `dupC-${uid}`, D = `dupD-${uid}`;
  await seedHousehold(fsAdmin, C, bossE, [bossE, twinE], 'C');
  await seedHousehold(fsAdmin, D, twinE, [twinE], 'D');
  const twin = await person(phone, 'twin2', twinE);
  await expect(twin.locator('#main [data-act="merge-open"]')).toBeVisible();
  await twin.click('[data-act="merge-open"]');
  const sheet = sheetOpen(twin);
  await sheet.locator(`input[name="kh-keep"][value="${D}"]`).check();
  await expect(sheet).toContainText(/Only whoever started a household can merge it away\. Ask C:boss to merge them/);
  await expect(sheet.locator('[data-pm="go"]')).toBeDisabled();
  const denyDelete = await inPage(twin, async (F, id) => {
    try { await F.deleteDoc(F.doc(F.getFirestore(), 'households', id)); return 'deleted'; } catch (e) { return e.code; }
  }, C);
  expect(denyDelete, 'a member who isn’t the owner can’t delete the household').toBe('permission-denied');
  expect(await fsAdmin.get(`households/${C}`), 'still there').toBeTruthy();
  await sheet.locator('[data-ha-close]').click();
  await expect(sheet).toHaveCount(0);
});

test('a merge whose copy fails deletes nothing', async ({ phone, fsAdmin, uid }) => {
  const twinE = `twin3-${uid}@example.com`, E = `dupE-${uid}`, F = `dupF-${uid}`;
  // an item the rules refuse (thumbnail over 12 KB) stops the merge
  await seedHousehold(fsAdmin, E, twinE, [twinE], 'E', { extra: { thumb: 'A'.repeat(13000) } });
  await seedHousehold(fsAdmin, F, twinE, [twinE, `x1-${uid}@example.com`], 'F');
  const twin = await person(phone, 'twin3', twinE);
  await expect(twin.locator('#main [data-act="merge-open"]')).toBeVisible();
  await twin.click('[data-act="merge-open"]');
  await sheetOpen(twin).locator('[data-pm="go"]').click();
  await twin.locator('dialog[open] button', { hasText: /^Merge$/ }).click();
  await expect(twin.locator('#kh-merge-msg', { hasText: 'Nothing was lost' })).toBeVisible();
  expect(await fsAdmin.get(`households/${E}`), 'the other household is still there').toBeTruthy();
  expect((await fsAdmin.list(`households/${E}/items`)).length, 'and its items').toBe(2);
  expect((await fsAdmin.list(`households/${E}/photos`)).length, 'and its photos').toBe(2);
  expect(await fsAdmin.get(`households/${F}`)).toBeTruthy();
});

test('no signal: “can’t tell” is never “no household”, and nothing is created offline', async ({ phone, fsAdmin, uid }) => {
  const offE = `off-${uid}@example.com`, offH = `off-${uid}`;
  await household(fsAdmin, offH, offE, [offE]);
  const off = await phone('off', { ignoreConsole: /./ });   // an unreachable Firestore logs its own errors
  await off.context().route(/:8085\//, r => r.abort());   // the household's server can't be reached
  await off.goto('/kakihome/?emulator#/settings');
  await signInAs(off, offE);
  await expect(off.locator('#main', { hasText: 'Can’t check right now' })).toBeVisible({ timeout: 60_000 });
  await expect(off.locator('[data-act="hh-create"]'), 'offline: no Start our household').toHaveCount(0);
  await expect(off.locator('[data-act="hh-check"]'), 'a Try again instead').toHaveCount(1);
  expect(await fsAdmin.owned(offE), 'nothing was created').toBe(1);
  await off.click('[data-act="hh-check"]');
  await expect(off.locator('.ha-toast')).toBeVisible();
  await expect(off.locator('[data-act="hh-create"]'), 'still offline: still no Start').toHaveCount(0);
  await off.context().unroute(/:8085\//);
  await off.click('[data-act="hh-check"]');
  await off.waitForFunction(h => window.__kakihome.S.household?.id === h, offH, { timeout: 30_000 });
  expect(await fsAdmin.owned(offE), 'online again: the existing household opened, no second one').toBe(1);
});

test('a double tap on Start our household makes one household, not two', async ({ phone, fsAdmin, uid }) => {
  const quickE = `quick-${uid}@example.com`;
  const quick = await person(phone, 'quick', quickE);
  await quick.locator('[data-act="hh-create"]').dblclick();
  await expect(quick.locator('#main .ha-row-title', { hasText: 'Our home' })).toBeVisible();
  await expect.poll(() => fsAdmin.owned(quickE), { message: 'one household after a double tap' }).toBe(1);
});

test('signing out goes back to this phone’s own (empty) list', async ({ phone, fsAdmin, uid }) => {
  const mumE = `mum-${uid}@example.com`, hid = `hh-${uid}`;
  await household(fsAdmin, hid, mumE, [mumE]);
  const mum = await person(phone, 'mum', mumE, hid);
  await mum.click('[data-act="signout"]');
  await expect(mum.locator('[data-act="signin"]')).toBeVisible();
  await go(mum, '#/');
  await expect(mum.locator('.ha-large-sub')).toHaveText('Saved on this phone');
});
