// The data path on app-sync 0.4.1 (cloud.js), against the local emulators (demo-kakihome, fake accounts; never the live
// project): the delete feed, saves that wait in the outbox, the status line, sign-out. Run: npx playwright test engine
import { test, expect } from './fixtures.mjs';

const HOME = '2026-10-16T00:00:00.000Z', OLD = '2026-10-17T00:00:00.000Z';
const BLOCK = /:8085\//;   // the household's server can't be reached
const SUB = '.ha-large-sub';

async function signInAs(p, email) {
  await p.waitForFunction(() => window.__kakihome?.signIn);
  await p.evaluate(async e => { const { auth } = await window.__kakihome.S.cloud.sdk(); await auth.authStateReady(); await window.__kakihome.signIn(e); }, email);
}
async function person(phone, name, email, hid, opts = {}) {
  const p = await phone(name, { url: '/kakihome/?emulator#/settings', ...opts });
  await signInAs(p, email);
  await expect.poll(() => p.evaluate(() => window.__kakihome.S.household?.id)).toBe(hid);
  return p;
}
const home = (fsAdmin, id, owner, members) => fsAdmin.put(`households/${id}`, { name: 'Our home', owner, members, createdAt: HOME });
const seed = (fsAdmin, hid, id) => fsAdmin.put(`households/${hid}/items/${id}`, { id, name: `Thing ${id}`, batches: [], updatedAt: OLD });
const sync = p => p.evaluate(() => window.__kakihome.S.sync && { state: window.__kakihome.S.sync.state, count: window.__kakihome.S.sync.count });
const names = p => p.evaluate(() => [...window.__kakihome.S.items.values()].map(i => i.name).sort());

test('a delete writes a feed entry, and another phone drops the item, also one that was closed meanwhile', async ({ phone, fsAdmin, uid }) => {
  const mumE = `mum-${uid}@example.com`, dadE = `dad-${uid}@example.com`, hid = `hh-${uid}`;
  await home(fsAdmin, hid, mumE, [mumE, dadE]);
  for (const id of ['a', 'b', 'c']) await seed(fsAdmin, hid, id);
  const mum = await person(phone, 'mum', mumE, hid);
  const dad = await person(phone, 'dad', dadE, hid);
  await expect.poll(() => names(dad)).toEqual(['Thing a', 'Thing b', 'Thing c']);
  // an open phone hears it
  await mum.evaluate(() => window.__kakihome.S.backend.del('items', 'a'));
  await expect.poll(() => names(dad), 'an open phone drops it').toEqual(['Thing b', 'Thing c']);
  const feed = await fsAdmin.list(`households/${hid}/bin`);
  expect(feed.map(e => [e.id, e.kind, e.data.id]), 'the entry written with the delete').toEqual([['items:a', 'items', 'a']]);
  // a phone that is closed while another deletes: it has the delta (changes since its last sync), which a deleted
  // document is never part of, so only the feed tells it
  const ctx = dad.context();
  await expect.poll(() => sync(dad)).toEqual({ state: 'synced', count: 0 });
  await dad.close();
  await mum.evaluate(() => window.__kakihome.S.backend.del('items', 'b'));
  await expect.poll(async () => (await fsAdmin.list(`households/${hid}/bin`)).length).toBe(2);
  const dad2 = await ctx.newPage();
  await dad2.goto('/kakihome/?emulator#/items');
  await expect.poll(() => dad2.evaluate(() => window.__kakihome?.S.household?.id)).toBe(hid);
  await expect.poll(() => names(dad2), 'a reopened phone drops it too').toEqual(['Thing c']);
});

test('a save made without signal waits in the outbox, survives a reload and reaches the household when it can', async ({ phone, fsAdmin, uid }) => {
  const mumE = `mum-${uid}@example.com`, hid = `hh-${uid}`;
  await home(fsAdmin, hid, mumE, [mumE]);
  const mum = await person(phone, 'mum', mumE, hid, { ignoreConsole: /./ });
  await go(mum, '#/');
  await expect(mum.locator(SUB)).toHaveText('Shared household');
  await mum.context().route(BLOCK, r => r.abort());
  await mum.evaluate(() => window.__kakihome.S.backend.put('items', { id: 'late', name: 'Made offline', batches: [] }));
  await expect.poll(() => sync(mum)).toEqual({ state: 'saving', count: 1 });
  await expect(mum.locator(SUB), 'the status line says so').toHaveText('Saving 1 change…');
  expect(await fsAdmin.get(`households/${hid}/items/late`), 'not on the server yet').toBeNull();
  // the page goes away and comes back with the server still out of reach: the outbox is on the phone
  await mum.reload();
  await mum.waitForFunction(() => window.__kakihome?.S);
  await mum.context().unroute(BLOCK);
  await mum.evaluate(() => dispatchEvent(new Event('online')));
  await expect.poll(async () => (await fsAdmin.get(`households/${hid}/items/late`))?.name, { timeout: 30_000 }).toBe('Made offline');
  const saved = await fsAdmin.get(`households/${hid}/items/late`);
  expect(typeof saved.updatedAt, 'stamped as an ISO string by the engine').toBe('string');
});

test('the status line follows the saving, and says synced only once the server has answered', async ({ phone, fsAdmin, uid }) => {
  const mumE = `mum-${uid}@example.com`, hid = `hh-${uid}`;
  await home(fsAdmin, hid, mumE, [mumE]);
  const mum = await person(phone, 'mum', mumE, hid, { ignoreConsole: /./ });
  await go(mum, '#/');
  await expect.poll(() => sync(mum)).toEqual({ state: 'synced', count: 0 });
  await expect(mum.locator(SUB)).toHaveText('Shared household');
  await mum.context().route(BLOCK, r => r.abort());
  await mum.evaluate(() => { const b = window.__kakihome.S.backend; b.put('items', { id: 'x1', name: 'One', batches: [] }); b.put('items', { id: 'x2', name: 'Two', batches: [] }); });
  await expect(mum.locator(SUB)).toHaveText('Saving 2 changes…');
  await mum.context().unroute(BLOCK);
  await mum.evaluate(() => dispatchEvent(new Event('online')));   // what the browser says when the signal is back: the queue sends again
  await expect.poll(() => sync(mum), { timeout: 30_000 }).toEqual({ state: 'synced', count: 0 });
  await expect(mum.locator(SUB)).toHaveText('Shared household');
});

test('signing out waits while saves are unsent, then wipes this phone’s copy and outbox', async ({ phone, fsAdmin, uid }) => {
  const mumE = `mum-${uid}@example.com`, hid = `hh-${uid}`;
  await home(fsAdmin, hid, mumE, [mumE]);
  await seed(fsAdmin, hid, 'a');
  const mum = await person(phone, 'mum', mumE, hid, { ignoreConsole: /./ });
  await expect.poll(() => names(mum)).toEqual(['Thing a']);
  await mum.context().route(BLOCK, r => r.abort());
  await mum.evaluate(() => window.__kakihome.S.backend.put('items', { id: 'b', name: 'Unsent', batches: [] }));
  await expect.poll(() => sync(mum)).toEqual({ state: 'saving', count: 1 });
  await mum.click('[data-act="signout"]');
  const ask = mum.locator('dialog[open]', { hasText: 'Sign out now?' });
  await expect(ask, 'unsent saves: asked first').toBeVisible({ timeout: 15_000 });
  await ask.getByRole('button', { name: 'Wait' }).click();
  expect(await mum.evaluate(() => window.__kakihome.S.user?.email), 'still signed in').toBe(mumE);
  expect(await sync(mum), 'and nothing was dropped').toEqual({ state: 'saving', count: 1 });
  // "Sign out anyway" while saves are unsent: forgetDevice refuses, nothing is wiped, and the phone keeps listening
  await mum.click('[data-act="signout"]');
  await expect(ask).toBeVisible({ timeout: 15_000 });
  await ask.getByRole('button', { name: 'Sign out anyway' }).click();
  await expect(mum.locator('.ha-toast.is-visible', { hasText: 'still signed in' })).toBeVisible({ timeout: 15_000 });
  expect(await mum.evaluate(() => window.__kakihome.S.user?.email), 'still signed in after the refusal').toBe(mumE);
  await mum.context().unroute(BLOCK);
  await fsAdmin.put(`households/${hid}/items/c`, { id: 'c', name: 'From elsewhere', batches: [], updatedAt: '2026-10-25T00:00:00.000Z' });
  await mum.evaluate(() => dispatchEvent(new Event('online')));
  await expect.poll(() => names(mum), 'the listeners were started again').toContain('From elsewhere');
  await expect.poll(async () => (await fsAdmin.get(`households/${hid}/items/b`))?.name, { timeout: 30_000 }).toBe('Unsent');
  await expect.poll(() => sync(mum)).toEqual({ state: 'synced', count: 0 });
  const left = () => mum.evaluate(async hid => {
    const AS = await import('https://core.anawj.com/sync/1.4.0/src/outbox.js');
    const dbs = (await indexedDB.databases()).map(d => d.name).filter(n => /^kakihome-sync:/.test(n));
    return { dbs, outbox: await AS.createOutbox({ name: 'kakihome-outbox' }).list(hid) };
  }, hid);
  expect((await left()).dbs.length, 'a device copy of the household exists').toBeGreaterThan(0);
  await mum.click('[data-act="signout"]');
  await expect(mum.locator('[data-act="signin"]')).toBeVisible({ timeout: 15_000 });
  expect(await left(), 'the copy is gone, the outbox is empty').toEqual({ dbs: [], outbox: [] });
  await go(mum, '#/');
  await expect(mum.locator(SUB)).toHaveText('Saved on this phone');
});

const go = (p, h) => p.evaluate(x => { location.hash = x; }, h);

const FSJS = 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
const inPage = (p, fn, ...args) => p.evaluate(`(async () => { const F = await import(${JSON.stringify(FSJS)}); return (${fn.toString()})(F, ...${JSON.stringify(args)}); })()`);

test('rules: the delete feed is for members, with a fixed shape', async ({ phone, fsAdmin, uid }) => {
  const mumE = `mum-${uid}@example.com`, strE = `stranger-${uid}@example.com`, hid = `hh-${uid}`;
  await home(fsAdmin, hid, mumE, [mumE]);
  const mum = await person(phone, 'mum', mumE, hid);
  const stranger = await phone('stranger', { url: '/kakihome/?emulator#/settings' }); await signInAs(stranger, strE);
  const tries = [
    ['good', { id: 'items:a', kind: 'items', data: { id: 'a', updatedAt: OLD }, deletedAt: OLD, updatedAt: OLD }],
    ['extra field', { id: 'items:b', kind: 'items', data: { id: 'b' }, deletedAt: OLD, note: 'x' }],
    ['other kind', { id: 'photos:c', kind: 'photos', data: { id: 'c' }, deletedAt: OLD }],
    ['id not kind:id', { id: 'items:zzz', kind: 'items', data: { id: 'd' }, deletedAt: OLD }],
    ['deletedAt a number', { id: 'items:e', kind: 'items', data: { id: 'e' }, deletedAt: 5 }],
  ];
  const out = await inPage(mum, async (F, hid, tries) => {
    const db = F.getFirestore(), r = [];
    for (const [, d] of tries) { try { await F.setDoc(F.doc(db, 'households', hid, 'bin', d.id.replace(':', '_')), d); r.push('ok'); } catch (e) { r.push(e.code); } }
    r.push(await F.getDocs(F.collection(db, 'households', hid, 'bin')).then(s => s.size, e => e.code));
    return r;
  }, hid, tries);
  expect(out, 'a member: only the well-formed entry is taken').toEqual(['ok', 'permission-denied', 'permission-denied', 'permission-denied', 'permission-denied', 1]);
  {
    const denied = await inPage(stranger, async (F, hid) => {
      const db = F.getFirestore(), r = [];
      r.push(await F.getDocs(F.collection(db, 'households', hid, 'bin')).then(() => 'listed', e => e.code));
      r.push(await F.setDoc(F.doc(db, 'households', hid, 'bin', 'items_x'), { id: 'items:x', kind: 'items', data: { id: 'x' }, deletedAt: '2026-10-17T00:00:00.000Z' }).then(() => 'wrote', e => e.code));
      return r;
    }, hid);
    expect(denied, 'an outsider').toEqual(['permission-denied', 'permission-denied']);
  }
});

// (Clearing the SDK cache when another tab holds it: the engine's own clearCache gives up after 3 s since app-sync 0.4.2,
// tested there; createApp skips it on the emulator, so there is nothing of Kaki Home's own left to test here.)

test('merging away a household also removes its delete feed', async ({ phone, fsAdmin, uid }) => {
  const mumE = `mum-${uid}@example.com`, hid = `hh-${uid}`;
  await home(fsAdmin, hid, mumE, [mumE]);
  await fsAdmin.put(`households/${hid}/bin/items_x`, { id: 'items:x', kind: 'items', data: { id: 'x' }, deletedAt: OLD });
  await seed(fsAdmin, hid, 'a');
  const mum = await person(phone, 'mum', mumE, hid);
  await mum.evaluate(h => window.__kakihome.S.cloud.removeHousehold(h), hid);
  expect(await fsAdmin.list(`households/${hid}/bin`), 'no feed left behind').toEqual([]);
  expect(await fsAdmin.list(`households/${hid}/items`)).toEqual([]);
  expect(await fsAdmin.get(`households/${hid}`)).toBeNull();
});
