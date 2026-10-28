// Household sharing: Google sign-in and one shared household ("household") in Firestore.
// Loaded only when config.js has a Firebase config (or ?emulator on localhost for tests), so the app works on
// one phone with no account at all until the household is set up (SETUP.md).
//
// Firestore layout (rules in firestore.rules):
//   households/{hid}                 { name, owner: email, members: [emails], createdAt }
//   households/{hid}/items/{id}      one product with its stock batches (and a small photo)
//   households/{hid}/events/{id}     bought / opened / used up / thrown away, for the consumption pattern
//   households/{hid}/shop/{id}       things added to the shopping list by hand
//
// Sign-in happens on the app's own address: authDomain is kakihome.flamingbeing.com (config.js, written by
// tools/set-config.mjs), and the Worker serves Firebase's helper pages at /__/auth/ and the project's init.json at
// /__/firebase/. A redirect then never crosses to another site, so installed iPhone apps keep their sign-in state
// (the anawj.com logbook's fix for "missing initial state").

import { firebaseConfig } from '../config.js';
import { KINDS, PHOTOS, prefs } from './store.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0/';
export const APP_HOST = 'kakihome.flamingbeing.com';

const emulator = (() => {
  try {
    if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return null;
    const v = new URLSearchParams(location.search).get('emulator');
    if (v === null) return null;
    const [fs, auth] = v.split(':').map(Number);
    return { fs: fs || 8085, auth: auth || 9099 };
  } catch { return null; }
})();
export const usingEmulator = !!emulator;

export const configured = !!emulator || !!(firebaseConfig && firebaseConfig.apiKey && firebaseConfig.projectId);

// The SDK loads once: every caller shares one promise (v1 loaded it twice when two calls raced, and the second
// initializeApp broke the auth emulator). A failed load (no signal on the very first open) is tried again next time.
let fb = null;
export function sdk() {
  if (fb) return fb;
  fb = load();
  fb.catch(() => { fb = null; });
  return fb;
}
async function load() {
  const [app, A, F] = await Promise.all([
    import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-firestore.js'),
  ]);
  const cfg = emulator
    ? { apiKey: 'demo-key', projectId: 'demo-kakihome', authDomain: 'localhost', appId: 'demo' }
    : { ...firebaseConfig, authDomain: firebaseConfig.authDomain || APP_HOST };
  const a = app.initializeApp(cfg);
  const auth = A.getAuth(a);
  let db;
  if (emulator) {
    db = F.getFirestore(a);
    F.connectFirestoreEmulator(db, '127.0.0.1', emulator.fs);
    A.connectAuthEmulator(auth, `http://127.0.0.1:${emulator.auth}`, { disableWarnings: true });
  } else {
    // keeps a copy on the phone, so Kaki Home opens and saves with no signal and catches up later
    try { db = F.initializeFirestore(a, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }); }
    catch { db = F.getFirestore(a); }
  }
  return { A, F, auth, db };
}

const lc = s => String(s || '').trim().toLowerCase();

// Plain words for anything that goes wrong (never the raw error text).
export function explain(err, doing = 'That') {
  const code = String(err?.code || '');
  if (/popup-closed-by-user|cancelled-popup-request|user-cancelled/.test(code)) return 'Sign-in was cancelled.';
  if (/network-request-failed|unavailable|deadline-exceeded/.test(code) || err?.name === 'TypeError') return 'No signal, so that didn’t work. Try again when you’re online.';
  if (/unauthorized-domain/.test(code)) return 'This address isn’t allowed to sign in yet. Kaki Home’s setup needs finishing (SETUP.md).';
  if (/permission-denied/.test(code)) return 'This account isn’t in that household.';
  if (/too-many-requests|resource-exhausted/.test(code)) return 'Too many tries. Wait a minute and try again.';
  if (/user-disabled/.test(code)) return 'This account can’t sign in.';
  if (/wrong-password|invalid-credential/.test(code)) return 'That email and password don’t match. Check them, or tap Forgot password.';
  if (/user-not-found/.test(code)) return 'There’s no account with that email yet. Tap Create account to make one.';
  if (/email-already-in-use/.test(code)) return 'That email already has an account. Tap Sign in, or Forgot password.';
  if (/weak-password/.test(code)) return 'That password is too easy to guess. Use at least 8 characters.';
  if (/invalid-email/.test(code)) return 'That doesn’t look like an email address.';
  if (/missing-email/.test(code)) return 'Type your email address first.';
  if (/missing-password/.test(code)) return 'Type your password.';
  if (/expired-action-code/.test(code)) return 'That link has expired or was already used. Ask for a new one.';
  if (/invalid-action-code/.test(code)) return 'That link isn’t valid any more. Ask for a new one.';
  if (/merge-count/.test(code)) return 'Not everything arrived in the household you’re keeping, so nothing was deleted.';
  if (/operation-not-allowed/.test(code)) return 'This way of signing in isn’t switched on yet.';
  return `${doing} didn’t work. Try again in a moment.`;
}

// Sign in by redirect straight away in the installed app (display-mode standalone, or iOS's navigator.standalone)
// and on Firefox for Android (a popup there opens as a separate tab that can't hand back; the anawj.com lesson).
// Elsewhere, a popup, falling back to a redirect when popups are blocked or unsupported (createApp's signIn).
export const redirectFirst = ({ standalone = false, ua = '' } = {}) => standalone || (/Android/i.test(ua) && /Firefox\//i.test(ua));
const installedApp = () => {
  try { return !!(globalThis.matchMedia?.('(display-mode: standalone)').matches || globalThis.matchMedia?.('(display-mode: fullscreen)').matches || globalThis.navigator?.standalone); } catch { return false; }
};

// What the app needs to know about the signed-in account. `verified` is false for a new password account until the
// person taps the emailed link: the rules need a verified email, so the app shows no household data until then. (Google
// and email-link sign-ins are verified already.)
export const userInfo = u => u ? { email: lc(u.email), name: u.displayName || u.email, photo: u.photoURL || '', verified: u.emailVerified === true } : null;

// ---- email link and password (besides Google) ----------------------------------------------------------------------

// Where an emailed link brings the person back: the app's own address (installed apps and the home screen open this).
// On localhost (the emulator tests) it is the page the test is on.
export const continueUrl = ({ hostname = '', origin = '', pathname = '/' } = {}) =>
  /^(localhost|127\.0\.0\.1)$/.test(hostname) ? origin + pathname : `https://${APP_HOST}/`;
const here = () => continueUrl({ hostname: location.hostname, origin: location.origin, pathname: location.pathname });
export const goodEmail = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || '').trim());
export const MIN_PASSWORD = 8;
// The query that Firebase's emailed link adds (apiKey, oobCode, mode, lang) comes off the address once used.
export const stripLinkParams = (href, keep = ['emulator']) => {
  const u = new URL(href);
  const q = u.search.slice(1).split('&').filter(p => p && keep.includes(decodeURIComponent(p.split('=')[0])));
  return u.pathname + (q.length ? '?' + q.join('&') : '') + u.hash;
};
const KEY = 'emailForSignIn';
export const savedEmail = () => lc(prefs.get(KEY, ''));

export async function sendLink(email) {
  const e = lc(email);
  if (!e) throw { code: 'auth/missing-email' };
  if (!goodEmail(e)) throw { code: 'auth/invalid-email' };
  const { A, auth } = await sdk();
  await A.sendSignInLinkToEmail(auth, e, { url: here(), handleCodeInApp: true });
  prefs.set(KEY, e);   // the link may open in this same browser (no need to type the email again) or another one
}
export async function isEmailLink(href = location.href) {
  const { A, auth } = await sdk();
  return A.isSignInWithEmailLink(auth, href);
}
// Finishes the sign-in with the emailed link. The address is the one saved on this phone when the link was asked for;
// a link opened in another browser needs the person to type it.
export async function finishLink(email, href = location.href) {
  const e = lc(email);
  if (!e) throw { code: 'auth/missing-email' };
  const { A, auth } = await sdk();
  await A.signInWithEmailLink(auth, e, href);
  prefs.del(KEY);
}
export async function passwordSignIn(email, password) {
  const e = lc(email);
  if (!e) throw { code: 'auth/missing-email' };
  if (!password) throw { code: 'auth/missing-password' };
  const { A, auth } = await sdk();
  await A.signInWithEmailAndPassword(auth, e, password);
}
// A new account: the person must tap the emailed link before the app treats them as signed in.
export async function passwordCreate(email, password) {
  const e = lc(email);
  if (!e) throw { code: 'auth/missing-email' };
  if (!goodEmail(e)) throw { code: 'auth/invalid-email' };
  if (String(password || '').length < MIN_PASSWORD) throw { code: 'auth/weak-password' };
  const { A, auth } = await sdk();
  const c = await A.createUserWithEmailAndPassword(auth, e, password);
  await A.sendEmailVerification(c.user, { url: here() });
  return userInfo(c.user);
}
export async function resendVerification() {
  const { A, auth } = await sdk();
  if (!auth.currentUser) throw { code: 'auth/user-not-found' };
  await A.sendEmailVerification(auth.currentUser, { url: here() });
}
// "I've verified": reload the account and its sign-in token (the token carries email_verified), then say how it stands.
export async function refreshUser() {
  const { auth } = await sdk();
  const u = auth.currentUser;
  if (!u) return null;
  await u.reload();
  await u.getIdToken(true);
  return userInfo(u);
}
export async function resetPassword(email) {
  const e = lc(email);
  if (!e) throw { code: 'auth/missing-email' };
  if (!goodEmail(e)) throw { code: 'auth/invalid-email' };
  const { A, auth } = await sdk();
  await A.sendPasswordResetEmail(auth, e, { url: here() });
}
// Tests only (?emulator): sign in as a made-up Google account.
export async function emulatorSignIn(email) {
  if (!emulator) throw new Error('Only with ?emulator');
  const { A, auth } = await sdk();
  await A.signInWithCredential(auth, A.GoogleAuthProvider.credential(JSON.stringify({ sub: lc(email).replace(/\W/g, ''), email: lc(email), email_verified: true })));
}
// The household this account belongs to (the owner adds members by their email). An account can end up in more than
// one (a second "Start our household" tapped when the first couldn't be found), and a query's first match is
// arbitrary: so pick the one this phone used last (`prefer`), else the one with the most members, else the oldest.
export const pickHousehold = (list, prefer = '') => list.length < 2 ? (list[0] || null)
  : list.find(h => h.id === prefer) || [...list].sort((a, b) => (b.members?.length || 0) - (a.members?.length || 0) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || (a.id < b.id ? -1 : 1))[0];
export async function findHouseholds(email) {
  const { F, db } = await sdk();
  const q = F.query(F.collection(db, 'households'), F.where('members', 'array-contains', lc(email)), F.limit(10));
  // From the server, never the phone's copy: offline this throws ("can't tell") instead of answering "none" from an
  // empty or old copy, which would offer to start a second household.
  const s = await F.getDocsFromServer(q);
  return s.docs.map(d => ({ id: d.id, ...d.data() }));
}
export async function findHousehold(email, prefer = '') { return pickHousehold(await findHouseholds(email), prefer); }
export async function createHousehold(email, name = 'Our home') {
  const { F, db } = await sdk();
  const ref = F.doc(F.collection(db, 'households'));
  const data = { name, owner: lc(email), members: [lc(email)], createdAt: new Date().toISOString() };
  // A transaction needs the server: offline it fails at once, where a plain setDoc would queue on the phone and create
  // the household later, whenever signal came back (even if one already existed).
  await F.runTransaction(db, async t => { t.set(ref, data); });
  return { id: ref.id, ...data };
}
export async function setMembers(hid, members) {
  const { F, db } = await sdk();
  await F.updateDoc(F.doc(db, 'households', hid), { members: [...new Set(members.map(lc).filter(Boolean))] });
}
// Calls `cb(household)` when the household changes, and `cb(null)` once when it is gone or can't be read any more
// (deleted or merged away by its owner, this account removed from it, or the rules said no: a listener that fails is
// finished). A copy the phone made up from its own cache (no signal, nothing cached) is not "gone": only the server
// saying so counts.
export async function watchHousehold(hid, cb) {
  const { F, db } = await sdk();
  let last = '';
  return F.onSnapshot(F.doc(db, 'households', hid), { includeMetadataChanges: true }, s => {
    if (!s.exists()) { if (!s.metadata.fromCache && last !== 'gone') { last = 'gone'; cb(null); } return; }
    const h = { id: s.id, ...s.data() }, j = JSON.stringify(h);
    if (j !== last) { last = j; cb(h); }
  }, e => { console.warn('household', e?.code); if (last !== 'gone') { last = 'gone'; cb(null); } });
}

// Firestore can't store undefined; drop it.
const clean = o => JSON.parse(JSON.stringify(o));

// Many documents at once: at most 400 to a batch or about 4 MB (photos are up to 150 KB each; Firestore takes about
// 10 MB a request).
async function writeAll(F, db, hid, kind, list) {
  let b = null, n = 0, bytes = 0;
  const at = new Date().toISOString();
  for (const o of list) {
    const c = clean(o), size = JSON.stringify(c).length;
    c.updatedAt = at;   // stamped now, so every phone's delta listener hears it
    if (b && (n >= 400 || bytes + size > 4e6)) { await b.commit(); b = null; }
    if (!b) { b = F.writeBatch(db); n = 0; bytes = 0; }
    b.set(F.doc(F.collection(db, 'households', hid, kind), o.id), c); n++; bytes += size;
  }
  if (b) await b.commit();
}
const MERGE_KINDS = ['items', 'events', 'shop', 'photos'];
const ALL_KINDS = [...MERGE_KINDS, 'settings'];
const DELETE_KINDS = [...ALL_KINDS, 'bin'];   // (removeHousehold also clears the delete feed)

export async function addMembers(hid, members) { return setMembers(hid, members); }
// Merging, step 1: copy everything in household `fromId` into `toId` (ids are random, so nothing clashes; running it
// again after a failure just writes the same documents again). Settings are merged, not copied over. Then COUNT: the
// kept household must hold at least as many documents of each kind as were copied. Throws if anything fails; never
// deletes. Resolves with how many were copied.
export async function copyHousehold(toId, fromId, members) {
  const { F, db } = await sdk();
  const read = async (hid, k) => (await F.getDocs(F.collection(db, 'households', hid, k))).docs.map(d => d.data());
  const out = {};
  const { mergeSettings } = await import('./merge.js');
  const photos = await read(fromId, 'photos');
  const photoIds = new Set(photos.map(p => p.id));
  const items = (await read(fromId, 'items')).map(it => {
    // an item from before thumbnails still holds a whole photo: the rules refuse new ones, so it moves to photos/<id>
    if (it.photo && !photoIds.has(it.id) && String(it.photo).length <= 150000) { photos.push({ id: it.id, data: it.photo, updatedAt: new Date().toISOString() }); photoIds.add(it.id); }
    const { photo, ...rest } = it;
    return rest;
  });
  const lists = { items, events: await read(fromId, 'events'), shop: await read(fromId, 'shop'), photos };
  for (const k of ['photos', 'items', 'events', 'shop']) { await writeAll(F, db, toId, k, lists[k]); out[k] = lists[k].length; }   // photos first, so no item points at a missing photo
  const settings = mergeSettings(await read(toId, 'settings'), await read(fromId, 'settings'), members);
  await writeAll(F, db, toId, 'settings', settings);
  for (const k of MERGE_KINDS) {
    const c = (await F.getCountFromServer(F.collection(db, 'households', toId, k))).data().count;
    if (c < out[k]) throw { code: 'merge-count', kind: k };
  }
  return out;
}
// Merging, step 2, only after step 1 for every household succeeded: delete household `hid` (its documents, then itself).
// Only its owner may (the rules).
export async function removeHousehold(hid) {
  const { F, db } = await sdk();
  for (const k of DELETE_KINDS) {
    const ids = (await F.getDocs(F.collection(db, 'households', hid, k))).docs.map(d => d.ref);
    for (let i = 0; i < ids.length; i += 400) {
      const b = F.writeBatch(db);
      for (const r of ids.slice(i, i + 400)) b.delete(r);
      await b.commit();
    }
  }
  await F.deleteDoc(F.doc(db, 'households', hid));
}

// ---- saving and listening through app-sync (core.anawj.com/sync/) ----------------------------------------------------
// One createApp call wires the engine: every save goes to an outbox on this phone first (IndexedDB), then to the server
// in a transaction, one document at a time and in order: nothing waits in the SDK's own offline queue, so a refused save
// is kept and a save made offline survives a reload. Each kind has a copy on this phone and listens only for documents
// changed since the last sync (`updatedAt`, stamped by the adapter at commit), so a quiet reopen reads about one document
// a kind. Saves are held conflicts by field (the core's default for every app): different fields merge on
// their own, the same field changed to the same value is no conflict, and a field changed on both phones to different
// values holds the save on the phone that sent it second until its person chooses (`onConflicts`, `resolve`; nothing is
// overwritten without asking). Photos stay last write wins (one blob per item). A delete writes a
// `bin` entry in the same transaction, which is how the other phones' delta listeners hear of it. createApp also brings
// the watchdog, the status, the storage guard at sign-in and the sign-out order (forgetDevice).
// (app-sync 1.x: createApp({ config, modules: [auth(), sync()] }), loaded through the page's import map, one exact
// version in index.html; the api is app.auth.* and app.sync.*.)
// photos only: a save on a photo another phone deleted brings it back, as setDoc did
const replace = (_current, record) => clean(record);
// `bin` entry for a deleted document (items/events/shop/settings; a photo has none: it is read one at a time)
const binWrite = ({ scope, coll, before, after, at, fields }) => !after && before && KINDS.includes(coll)
  ? [{ path: ['households', scope, 'bin', `${coll}:${before.id}`], data: { ...leaveEntry(coll, before, at), ...fields } }] : [];
let leaveEntry = null;
// This phone as people know it in a conflict sheet ("iPhone", "Android phone", "Computer")
const deviceName = () => { const ua = globalThis.navigator?.userAgent || ''; return /iPhone|iPod/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android phone' : 'Computer'; };

// The engine, once a page: the device copy, the outbox and the queue outlive a switch between households (the scope:
// the household's id), and signing out wipes them. Saves the server refused go to the open household's `onError`.
let engine = null, refused = null;
function sync() {
  if (engine) return engine;
  engine = (async () => {
    const [{ createApp }, { auth }, S] = await Promise.all([import('@core/app'), import('@core/auth'), import('@core/sync')]);
    leaveEntry = S.leaveEntry;
    const app = createApp({
      config: { name: 'kakihome', sdk: async () => ({ ...await sdk(), emulator: usingEmulator }) },
      modules: [
        auth({ redirectFirst: () => redirectFirst({ standalone: installedApp(), ua: globalThis.navigator?.userAgent || '' }) }),
        S.sync({
          colls: KINDS, path: (hid, kind) => ['households', hid, kind],
          device: deviceName(),
          backend: { time: 'iso', held: true, edits: '_edits', merge: { [PHOTOS]: replace }, onCommit: binWrite },
          stores: { metaOnly: ['bin'] },
          hub: { unstamped: 'full', bin: 'bin' },
          queue: {
            // writes sent straight to the SDK (copying a household, restoring a backup) keep the sign-out check shut until acknowledged
            otherPending: async () => { const { F, db } = await sdk(); return !(await Promise.race([F.waitForPendingWrites(db).then(() => true, () => false), new Promise(r => setTimeout(() => r(false), 1500))])); }
          },
          // a save the server refused: told to the app and set aside, so nothing is sent twice
          onRefused: (err, x) => { console.warn('save failed', x.kind, err.code); refused?.(err); return 'archive'; },
        }),
      ],
    });
    await app.ready;
    return app;
  })();
  engine.catch(() => { engine = null; });
  return engine;
}

export async function onUser(cb) { return (await sync()).auth.onUser(cb); }
export async function signIn() { return (await sync()).auth.signIn(); }
// True when every change made on this phone has reached the household within ms (false offline or on a timeout), so
// signing out doesn't silently drop changes still waiting for signal. It also refuses while another tab holds unsent
// saves or a direct write (copy, restore) is unacknowledged.
export async function synced(ms = 4000) { return engine ? (await engine).sync.flush(ms) : true; }
// Sign-out on a shared phone (createApp: forgetDevice's order): stop the listeners, check again nothing is unsent, wipe
// this phone's copy of the household, the outbox and the SDK's own offline cache, then sign out. With the real project
// the SDK is terminated by that, so the page reloads (the emulator tests keep their page and cache). Resolves false
// (nothing wiped, still signed in, the listeners started again) when saves turned up unsent.
export async function signOut() {
  // the sync module reloads the page itself once the SDK's cache was cleared (the emulator tests keep their page)
  const r = await (await sync()).auth.forget();
  return r.ok;
}

// `onError(err)` hears of a write the server refused; `onSync(state)` of how the saving stands ({ state, count }: app-sync
// syncStatus, with `confirmed` false until the server has answered once since the page opened).
// `onConflicts(list)` hears of this phone's held saves ([{ key, kind, id, deleted, fields, mine, theirs }]: app-sync
// describe), at once if some are waiting from an earlier session and again whenever they change; `resolve(key, choice)`
// answers one ('mine' | 'theirs' | { [field]: 'mine' | 'theirs' }).
export async function openCloud(hid, onError = () => {}, onSync = () => {}, onConflicts = () => {}) {
  const { F, db } = await sdk();
  const app = await sync();
  await app.sync.open(hid);
  refused = onError;
  const col = kind => F.collection(db, 'households', hid, kind);
  let closed = false, cb = null;
  const seen = Object.fromEntries(KINDS.map(k => [k, { ready: false }]));
  const known = Object.fromEntries(KINDS.map(k => [k, new Map()]));   // id -> signature, as last delivered
  const data = Object.fromEntries(KINDS.map(k => [k, new Map()]));
  const ready = Object.fromEntries(KINDS.map(k => { let done; const p = new Promise(r => { done = r; }); return [k, { p, done }]; }));
  // (told only once openCloud has returned: status$ answers at once, before the caller holds this household)
  let lastSt = null, live = false;
  const offStatus = app.sync.status$(st => { lastSt = st; if (live && !closed) onSync(st); });
  setTimeout(() => { live = true; if (!closed && lastSt) onSync(lastSt); }, 0);
  const heldNow = () => app.sync.conflicts().map(c => app.sync.describe(c.key)).filter(Boolean);
  let heldSig = '';
  const tellHeld = () => { if (closed) return; const l = heldNow(), g = JSON.stringify(l); if (g !== heldSig) { heldSig = g; onConflicts(l); } };
  const offHeld = app.sync.queue.onChange(tellHeld);
  setTimeout(tellHeld, 0);
  function enqueue(kind, record) {
    // base: the document as this phone had it (its last delivery) before this change, so a field changed only elsewhere
    // merges and only a field changed on both phones is held; a new document, and a photo (last write wins), have none
    const had = data[kind]?.get(record.id);
    return app.sync.save(kind, hid, record, had ? clean(had) : null)
      .then(() => true, e => { if (app.sync.queue.error()) { console.warn('outbox', e?.message); onError(e); } return false; });
  }
  // the listeners: each kind's whole list from the engine (this phone's copy, then the server's changes), with this
  // phone's saves not yet sent laid over it; only what changed since the last delivery goes to the app
  const sig = d => JSON.stringify(d);
  function deliver(k, list) {
    if (closed) return;
    const now = new Map(list.map(d => [d.id, d]));
    const docs = [], removed = [];
    for (const [id, d] of now) { const s = sig(d); if (known[k].get(id) !== s) { known[k].set(id, s); docs.push(d); } }
    for (const id of [...known[k].keys()]) if (!now.has(id)) { known[k].delete(id); removed.push(id); }
    data[k] = now;
    if (!seen[k].ready) { seen[k].ready = true; ready[k].done(); }
    else if (cb && (docs.length || removed.length)) cb(k, docs, removed);
  }
  let offs = [];
  const startListening = () => { if (!offs.length && !closed) offs = KINDS.map(k => app.sync.watch(hid, k, list => deliver(k, list))); };
  const stopListening = () => { offs.splice(0).forEach(off => off()); };
  startListening();
  app.sync.parts.watchdog.opened();
  return {
    kind: 'cloud',
    // what this phone holds now (its copy, or the server's first answer): each kind's first list, or after a few seconds
    // whatever there is (a phone that never synced, with no signal); the rest arrives through listen()
    async load() {
      await Promise.all(KINDS.map(k => Promise.race([ready[k].p, new Promise(r => setTimeout(r, 5000))])));
      for (const k of KINDS) if (!seen[k].ready) { seen[k].ready = true; ready[k].done(); }
      return Object.fromEntries(KINDS.map(k => [k, [...data[k].values()]]));
    },
    // Saves go to the outbox at once and reach the household when there's signal; don't wait for the server. The
    // promise (which callers may ignore) is true once the save is kept on this phone; a refusal comes through onError.
    put: (kind, obj) => enqueue(kind, clean(obj)),
    del: (kind, id) => {
      if (KINDS.includes(kind)) void app.sync.hub.drop(hid, kind, [id]);
      enqueue(kind, { id, _deleted: true });
    },
    // One document (an item's photo, when the item is opened), or null when there is none. Offline it is the
    // phone's copy if it has one; otherwise it throws, and the app tries again next time.
    async get(kind, id) {
      const s = await F.getDoc(F.doc(col(kind), id));
      return s.exists() ? s.data() : null;
    },
    // Every document of one kind (a backup's photos): only when someone asks for it.
    async list(kind) { return (await F.getDocs(col(kind))).docs.map(d => d.data()); },
    // Write many at once (copying the phone's list up, restoring a backup): at most 400 documents or about 4 MB
    // to a batch (photos are up to 150 KB each; Firestore takes about 10 MB a request), stamped now.
    putMany: (kind, list) => writeAll(F, db, hid, kind, list),
    listen(fn) { cb = fn; startListening(); },
    // The listener watchdog: `nudge('resume')` at a moment the phone came back (online, visible, pageshow).
    nudge: (event = '') => app.sync.nudge(event),
    resolve: (key, choice) => app.sync.resolve(key, choice),
    close() { closed = true; stopListening(); offStatus(); offHeld(); if (refused === onError) refused = null; },
  };
}
