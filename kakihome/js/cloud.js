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
import { KINDS, prefs } from './store.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
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
// Elsewhere, a popup, falling back to a redirect when popups are blocked or unsupported.
export const redirectFirst = ({ standalone = false, ua = '' } = {}) => standalone || (/Android/i.test(ua) && /Firefox\//i.test(ua));
const installedApp = () => {
  try { return !!(globalThis.matchMedia?.('(display-mode: standalone)').matches || globalThis.matchMedia?.('(display-mode: fullscreen)').matches || globalThis.navigator?.standalone); } catch { return false; }
};
const REDIRECT_CODES = ['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/web-storage-unsupported', 'auth/cancelled-popup-request'];

export async function onUser(cb) {
  const { A, auth } = await sdk();
  // finishes a redirect sign-in when the page loads again
  A.getRedirectResult(auth).catch(e => console.warn('Redirect sign-in failed', e?.code || e));
  A.onAuthStateChanged(auth, u => cb(userInfo(u)));
}
// What the app needs to know about the signed-in account. `verified` is false for a new password account until the
// person taps the emailed link: the rules need a verified email, so the app shows no household data until then. (Google
// and email-link sign-ins are verified already.)
export const userInfo = u => u ? { email: lc(u.email), name: u.displayName || u.email, photo: u.photoURL || '', verified: u.emailVerified === true } : null;

export async function signIn() {
  const { A, auth } = await sdk();
  const provider = new A.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  if (redirectFirst({ standalone: installedApp(), ua: globalThis.navigator?.userAgent || '' })) return A.signInWithRedirect(auth, provider);
  try { await A.signInWithPopup(auth, provider); }
  catch (e) {
    if (!REDIRECT_CODES.includes(e?.code)) throw e;
    await A.signInWithRedirect(auth, provider);
  }
}
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
// True when every change made on this phone has reached the household within ms (false offline or on a timeout), so
// signing out doesn't silently drop changes still waiting for signal.
export async function synced(ms = 4000) {
  const { F, db } = await sdk();
  return Promise.race([F.waitForPendingWrites(db).then(() => true, () => false), new Promise(r => setTimeout(() => r(false), ms))]);
}
export async function signOut() {
  const { A, auth } = await sdk();
  await A.signOut(auth);
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
export async function watchHousehold(hid, cb) {
  const { F, db } = await sdk();
  return F.onSnapshot(F.doc(db, 'households', hid), s => cb(s.exists() ? { id: s.id, ...s.data() } : null), () => cb(null));
}

// Firestore can't store undefined; drop it.
const clean = o => JSON.parse(JSON.stringify(o));

// Many documents at once: at most 400 to a batch or about 4 MB (photos are up to 150 KB each; Firestore takes about
// 10 MB a request).
async function writeAll(F, db, hid, kind, list) {
  let b = null, n = 0, bytes = 0;
  for (const o of list) {
    const c = clean(o), size = JSON.stringify(c).length;
    if (b && (n >= 400 || bytes + size > 4e6)) { await b.commit(); b = null; }
    if (!b) { b = F.writeBatch(db); n = 0; bytes = 0; }
    b.set(F.doc(F.collection(db, 'households', hid, kind), o.id), c); n++; bytes += size;
  }
  if (b) await b.commit();
}
const MERGE_KINDS = ['items', 'events', 'shop', 'photos'];
const ALL_KINDS = [...MERGE_KINDS, 'settings'];

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
  for (const k of ALL_KINDS) {
    const ids = (await F.getDocs(F.collection(db, 'households', hid, k))).docs.map(d => d.ref);
    for (let i = 0; i < ids.length; i += 400) {
      const b = F.writeBatch(db);
      for (const r of ids.slice(i, i + 400)) b.delete(r);
      await b.commit();
    }
  }
  await F.deleteDoc(F.doc(db, 'households', hid));
}

export async function openCloud(hid, onError = () => {}) {
  const { F, db } = await sdk();
  const col = kind => F.collection(db, 'households', hid, kind);
  const unsubs = [];
  return {
    kind: 'cloud',
    async load() {
      const out = {};
      for (const k of KINDS) {
        const s = await F.getDocs(col(k));
        out[k] = s.docs.map(d => d.data());
      }
      return out;
    },
    // Writes go to the phone's copy at once and reach the household when there's signal; don't wait for the server.
    // The promise (which callers may ignore) says whether the server took it: true, or false when refused.
    put: (kind, obj) => F.setDoc(F.doc(col(kind), obj.id), clean(obj)).then(() => true, e => { console.warn('save failed', e?.code); onError(e); return false; }),
    del: (kind, id) => { F.deleteDoc(F.doc(col(kind), id)).catch(e => { console.warn('delete failed', e?.code); onError(e); }); },
    // One document (an item's photo, when the item is opened), or null when there is none. Offline it is the
    // phone's copy if it has one; otherwise it throws, and the app tries again next time.
    async get(kind, id) {
      const s = await F.getDoc(F.doc(col(kind), id));
      return s.exists() ? s.data() : null;
    },
    // Every document of one kind (a backup's photos): only when someone asks for it.
    async list(kind) { return (await F.getDocs(col(kind))).docs.map(d => d.data()); },
    // Write many at once (copying the phone's list up, restoring a backup): at most 400 documents or about 4 MB
    // to a batch (photos are up to 150 KB each; Firestore takes about 10 MB a request).
    putMany: (kind, list) => writeAll(F, db, hid, kind, list),
    listen(cb) {
      for (const k of KINDS) {
        unsubs.push(F.onSnapshot(col(k), s => {
          const docs = [], removed = [];
          for (const c of s.docChanges()) (c.type === 'removed' ? removed.push(c.doc.id) : docs.push(c.doc.data()));
          if (docs.length || removed.length) cb(k, docs, removed);
        }, e => { console.warn('sync', k, e?.code); onError(e); }));
      }
    },
    close() { unsubs.splice(0).forEach(u => u()); },
  };
}
