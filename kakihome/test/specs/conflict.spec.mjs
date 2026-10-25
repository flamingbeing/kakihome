// Held conflicts by field (app-sync 0.6.3+, cloud.js `held`), against the local emulators (demo-kakihome, fake accounts):
// two phones change the same item while one is out of signal. Different fields merge on their own; the same field
// changed to different values holds the save on the phone that sent it second, until its person chooses.
// Run: npx playwright test conflict
import { test, expect } from './fixtures.mjs';
import { go } from './helpers.mjs';

const HOME = '2026-10-16T00:00:00.000Z', OLD = '2026-10-17T00:00:00.000Z';
const BLOCK = /:8085\//;   // the household's server can't be reached
const SUB = '.ha-large-sub';

async function person(phone, name, email, hid, opts = {}) {
  const p = await phone(name, { url: '/kakihome/?emulator#/settings', ...opts });
  await p.waitForFunction(() => window.__kakihome?.signIn);
  await p.evaluate(async e => { const { auth } = await window.__kakihome.S.cloud.sdk(); await auth.authStateReady(); await window.__kakihome.signIn(e); }, email);
  await expect.poll(() => p.evaluate(() => window.__kakihome.S.household?.id)).toBe(hid);
  return p;
}
const edit = (p, id, patch) => p.evaluate(([i, x]) => { const b = window.__kakihome.S.backend; return b.put('items', { ...structuredClone(window.__kakihome.S.items.get(i)), ...x }); }, [id, patch]);
const server = (fsAdmin, hid, id) => fsAdmin.get(`households/${hid}/items/${id}`);
const reconnect = async p => { await p.context().unroute(BLOCK); await p.evaluate(() => dispatchEvent(new Event('online'))); };

async function setup(phone, fsAdmin, uid) {
  const mumE = `mum-${uid}@example.com`, dadE = `dad-${uid}@example.com`, hid = `hh-${uid}`;
  await fsAdmin.put(`households/${hid}`, { name: 'Our home', owner: mumE, members: [mumE, dadE], createdAt: HOME });
  await fsAdmin.put(`households/${hid}/items/a`, { id: 'a', name: 'Soy', location: 'Pantry', batches: [], updatedAt: OLD });
  const mum = await person(phone, 'mum', mumE, hid, { ignoreConsole: /./ });
  const dad = await person(phone, 'dad', dadE, hid, { ignoreConsole: /./ });
  for (const p of [mum, dad]) await expect.poll(() => p.evaluate(() => window.__kakihome.S.items.get('a')?.name)).toBe('Soy');
  await go(mum, '#/'); await go(dad, '#/');
  return { mum, dad, hid };
}

test('different fields merge without asking; the same field is held on the phone that sent it second', async ({ phone, fsAdmin, uid }) => {
  const { mum, dad, hid } = await setup(phone, fsAdmin, uid);
  await mum.context().route(BLOCK, r => r.abort());
  await edit(mum, 'a', { name: 'Soy sauce', location: 'Fridge' });
  await edit(dad, 'a', { name: 'Light soy' });
  await expect.poll(async () => (await server(fsAdmin, hid, 'a'))?.name).toBe('Light soy');
  await reconnect(mum);
  // name clashes (held); location was only changed by mum: it is not part of the question
  await expect(mum.locator('[data-act="conflicts-open"]')).toBeVisible();
  await expect(mum.locator(SUB)).toContainText('1 change to check');
  await expect(dad.locator('[data-act="conflicts-open"]'), 'only the phone that sent it second is asked').toHaveCount(0);
  expect((await server(fsAdmin, hid, 'a')).name, 'nothing overwritten').toBe('Light soy');
  await mum.click('[data-act="conflicts-open"]');
  const sheet = mum.locator('dialog.ha-sheet[open]');
  await expect(sheet.locator('.ha-sheet-title')).toHaveText('Changed on another phone');
  await expect(sheet.locator('.kh-side').first()).toContainText('Soy sauce');
  await expect(sheet.locator('.kh-side').nth(1)).toContainText('Light soy');
  await sheet.locator('[data-cf="mine"]').click();
  await expect.poll(async () => { const s = await server(fsAdmin, hid, 'a'); return [s.name, s.location]; }).toEqual(['Soy sauce', 'Fridge']);
  await expect(mum.locator('[data-act="conflicts-open"]')).toHaveCount(0);
  await expect.poll(() => dad.evaluate(() => window.__kakihome.S.items.get('a')?.name)).toBe('Soy sauce');
});

test('keep theirs drops this phone’s clashing change and keeps its other changes', async ({ phone, fsAdmin, uid }) => {
  const { mum, dad, hid } = await setup(phone, fsAdmin, uid);
  await mum.context().route(BLOCK, r => r.abort());
  await edit(mum, 'a', { name: 'Soy sauce', location: 'Fridge' });
  await edit(dad, 'a', { name: 'Light soy' });
  await expect.poll(async () => (await server(fsAdmin, hid, 'a'))?.name).toBe('Light soy');
  await reconnect(mum);
  await mum.click('[data-act="conflicts-open"]');
  await mum.locator('dialog.ha-sheet[open] [data-cf="theirs"]').click();
  await expect.poll(async () => { const s = await server(fsAdmin, hid, 'a'); return [s.name, s.location]; }).toEqual(['Light soy', 'Fridge']);
  await expect(mum.locator('[data-act="conflicts-open"]')).toHaveCount(0);
});

test('an unanswered conflict stays in the status line, and is still there after a reload', async ({ phone, fsAdmin, uid }) => {
  const { mum, dad, hid } = await setup(phone, fsAdmin, uid);
  await mum.context().route(BLOCK, r => r.abort());
  await edit(mum, 'a', { name: 'Soy sauce' });
  await edit(dad, 'a', { name: 'Light soy' });
  await expect.poll(async () => (await server(fsAdmin, hid, 'a'))?.name).toBe('Light soy');
  await reconnect(mum);
  await expect(mum.locator(SUB)).toContainText('1 change to check');
  await mum.reload();
  await mum.waitForFunction(() => window.__kakihome?.S);
  await expect(mum.locator('[data-act="conflicts-open"]')).toBeVisible();
  expect((await server(fsAdmin, hid, 'a')).name).toBe('Light soy');
});
