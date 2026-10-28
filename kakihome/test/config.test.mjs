// node kakihome/test/config.test.mjs: the config tool, sign-in choice, plain-word errors and the service worker rules.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseConfig, files } from '../tools/set-config.mjs';
import { redirectFirst, explain, configured, pickHousehold, continueUrl, stripLinkParams, goodEmail, userInfo } from '../js/cloud.js';
import { firebaseConfig } from '../config.js';

// set-config reads Firebase's snippet as shown (unquoted keys, single quotes, trailing comma) and pins authDomain
const snippet = `const firebaseConfig = {
  apiKey: "AIzaFAKE-not-a-real-key",
  authDomain: "family-pantry.firebaseapp.com", // Firebase's own
  projectId: 'family-pantry',
  storageBucket: "family-pantry.firebasestorage.app",
  messagingSenderId: "123",
  appId: "1:123:web:abc",
};`;
const cfg = parseConfig(snippet);
assert.equal(cfg.authDomain, 'kakihome.flamingbeing.com');
assert.equal(cfg.projectId, 'family-pantry');
assert.deepEqual(parseConfig(JSON.stringify(cfg)), cfg);
assert.throws(() => parseConfig('{ "apiKey": "x" }'), /no projectId/);
assert.throws(() => parseConfig('nothing here'), /No \{/);
const out = files(cfg);
assert.match(out['config.js'], /export const firebaseConfig = \{/);
assert.equal(JSON.parse(out['auth/firebase/init.json']).authDomain, 'kakihome.flamingbeing.com');

// the committed config (written by set-config.mjs) signs in on the app's own address; with none, on-phone only
if (firebaseConfig) {
  assert.equal(firebaseConfig.authDomain, 'kakihome.flamingbeing.com');
  assert.ok(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
  assert.equal(configured, true);
} else assert.equal(configured, false);

// installed apps and Firefox on Android sign in by redirect; browser tabs by popup
assert.equal(redirectFirst({ standalone: true, ua: 'iPhone' }), true);
assert.equal(redirectFirst({ standalone: false, ua: 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0' }), true);
assert.equal(redirectFirst({ standalone: false, ua: 'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Safari/537.36' }), false);
assert.equal(redirectFirst({ standalone: false, ua: 'Mozilla/5.0 (iPhone) Safari' }), false);

// plain words, never the raw error
assert.equal(explain({ code: 'auth/popup-closed-by-user' }), 'Sign-in was cancelled.');
assert.match(explain({ code: 'auth/network-request-failed' }), /No signal/);
assert.match(explain({ code: 'permission-denied' }), /isn’t in that household/);
assert.equal(explain({ code: 'auth/internal-error', message: 'INTERNAL ASSERTION FAILED' }, 'Sign-in'), 'Sign-in didn’t work. Try again in a moment.');

// the service worker: plain VERSION, on app-update (exact pin), kit files and the page module offline
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
assert.match(sw, /const VERSION = 'kakihome-v\d+'/);
assert.match(sw, /^const MANIFEST = \{\};$/m, 'MANIFEST stays empty in git (the deploy fills it)');
assert.match(sw, /importScripts\('https:\/\/core\.anawj\.com\/update\/\d+\.\d+\.\d+\/sw-core\.js'\)/);
assert.match(sw, /AppUpdate\.init\(\{\s*app: 'kakihome'/);
assert.ok(!sw.includes("'index.html'"), 'pages are kept by the folder (./), never index.html');
for (const f of ['tokens.css', 'app.css', 'app.js', 'icons.svg'].map(f => 'https://design.flamingbeing.com/v1/' + f)) assert.ok(sw.includes(`'${f}'`), f);
const core = sw.match(/core\.anawj\.com\/update\/(\d+\.\d+\.\d+)\/sw-core/)[1];
assert.ok(sw.includes(`'https://core.anawj.com/update/${core}/register.js'`), 'register.js of the same version in SHELL');
const app = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
assert.ok(app.includes(`'https://core.anawj.com/update/${core}/register.js'`), 'the page loads the same register.js');
assert.ok(!/take-over|skipWaiting|Update ready/.test(app), 'no update toast or take-over message left');
// exact pins, one version each: the update module 0.2.0 (the reload waits while canReload says no) and app-sync 1.4.0
// (the page's import map: @core/app, @core/auth, @core/sync)
assert.equal(core, '0.2.0', 'the update module');
assert.match(app, /register\(\{[^}]*canReload: reloadOk/, 'the reload after an update asks canReload');
const cloud = fs.readFileSync(new URL('../js/cloud.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const map = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
for (const n of ['app', 'auth', 'sync']) assert.equal(map['@core/' + n], `https://core.anawj.com/sync/1.4.0/${n}.js`, '@core/' + n);
assert.ok(!('@core/update' in map), 'the update core is register.js, not the module');
const uiVer = map['@core/ui'].match(/\/ui\/([^/]+)\//)[1];
for (const n of ['ui', 'theme', 'settings']) assert.equal(map['@core/' + n], `https://core.anawj.com/ui/${uiVer}/${n}/index.js`, '@core/' + n + ' on one ui version');
// the entries and what they import are precached whole (install is all or nothing, and the app opens offline)
for (const f of ['app.js', 'auth.js', 'sync.js', 'src/module-sync.js', 'src/core.js', 'src/outbox.js']) assert.ok(sw.includes(`'https://core.anawj.com/sync/1.4.0/${f}'`), 'sw.js SHELL has ' + f);
for (const f of ['ui/index.js', 'theme/index.js', 'settings/index.js', 'theme/theme.css', 'ui/ui.css', 'theme/early.js']) assert.ok(sw.includes(`'https://core.anawj.com/ui/${uiVer}/${f}'`), 'sw.js SHELL has ' + f);
// no glass.css: the home kit's solid bars and sheets are the look this app matches (owner, 28 Oct)
assert.ok(!(sw + html).includes('theme/glass.css'), 'no glass.css');
assert.ok(!/sync\/(?!1\.4\.0)\d+\.\d+\.\d+\//.test(sw + app + cloud + html), 'no other engine version anywhere');
assert.match(sw, /name: 'pinned', match: \/\^https:\\\/\\\/core\\\.anawj\\\.com\\\/\(sync\|update\|ui\)/, 'pinned core files are cached as they are fetched');
// the engine is wired by one createApp call with the auth and sync modules; nothing of it is wired by hand here
assert.equal((cloud.match(/const app = createApp\(/g) || []).length, 1, 'one createApp');
assert.ok(!/(createSyncHub|createWriteQueue|createStores|createWatchdog|createFirestoreBackend|forgetDevice|persistGuard|replanOnWake|syncStatus)\(/.test(cloud), 'no hand wiring of the engine left');
assert.ok(!/A\.(signInWithPopup|signInWithRedirect|getRedirectResult|onAuthStateChanged|signOut)\(/.test(cloud), 'Google sign-in and sign-out are the auth module\'s');
assert.ok(!/F\.setDoc\(|F\.deleteDoc\(\s*F\.doc\(col/.test(cloud), 'no direct setDoc/deleteDoc for household data');
assert.equal((cloud.match(/F\.onSnapshot\(/g) || []).length, 1, 'one onSnapshot left: the household document itself (the collections go through the hub)');
console.log('kakihome config: ok');

// which family pantry opens when an account is in more than one: the remembered one, else the one with most people
{
  const a = { id: 'a', members: ['x@e.com'], createdAt: '2026-10-01' }, b = { id: 'b', members: ['x@e.com', 'y@e.com', 'z@e.com'], createdAt: '2026-10-05' };
  assert.equal(pickHousehold([]), null);
  assert.equal(pickHousehold([a]).id, 'a');
  assert.equal(pickHousehold([a, b]).id, 'b', 'most people');
  assert.equal(pickHousehold([b, a], 'a').id, 'a', 'the remembered one');
  assert.equal(pickHousehold([a, b], 'gone').id, 'b', 'a remembered one that is gone');
  assert.equal(pickHousehold([{ ...a, id: 'q' }, a]).id, 'a', 'same size: the oldest, then the lower id');
}
console.log('pickHousehold ok');

// email link and password: plain-word errors, the link's address, the cleaned-up address bar, the verified flag
{
  const said = c => explain({ code: c, message: 'Firebase: Error (' + c + ').' }, 'Sign-in');
  const cases = {
    'auth/wrong-password': /don’t match/, 'auth/invalid-credential': /don’t match/, 'auth/user-not-found': /Create account/,
    'auth/email-already-in-use': /already has an account/, 'auth/weak-password': /at least 8 characters/, 'auth/invalid-email': /doesn’t look like an email/,
    'auth/missing-email': /Type your email/, 'auth/missing-password': /Type your password/, 'auth/expired-action-code': /expired or was already used/,
    'auth/invalid-action-code': /isn’t valid any more/, 'auth/operation-not-allowed': /^This way of signing in isn’t switched on yet\.$/,
  };
  for (const [c, re] of Object.entries(cases)) { assert.match(said(c), re, c); assert.ok(!/auth\/|Firebase|Error/.test(said(c)), c + ' never shows raw text'); }
  assert.match(said('auth/too-many-requests'), /Too many tries/);
  assert.equal(continueUrl({ hostname: 'kakihome.flamingbeing.com', origin: 'https://kakihome.flamingbeing.com', pathname: '/index.html' }), 'https://kakihome.flamingbeing.com/');
  assert.equal(continueUrl({ hostname: 'localhost', origin: 'http://localhost:4000', pathname: '/kakihome/' }), 'http://localhost:4000/kakihome/');
  assert.equal(continueUrl({ hostname: 'anything.workers.dev', origin: 'https://anything.workers.dev', pathname: '/x/' }), 'https://kakihome.flamingbeing.com/', 'previews never get their own link');
  const link = 'https://kakihome.flamingbeing.com/?apiKey=k&oobCode=abc&mode=signIn&lang=en#/settings';
  assert.equal(stripLinkParams(link), '/#/settings');
  assert.equal(stripLinkParams('http://localhost:4000/kakihome/?emulator&oobCode=abc&mode=signIn'), '/kakihome/?emulator');
  assert.equal(stripLinkParams('http://localhost:4000/kakihome/'), '/kakihome/');
  assert.ok(goodEmail('a@b.co') && goodEmail(' a@b.co ') && !goodEmail('a@b') && !goodEmail('') && !goodEmail(null) && !goodEmail('a b@c.d'));
  assert.deepEqual(userInfo({ email: 'A@B.com', displayName: '', photoURL: null, emailVerified: false }), { email: 'a@b.com', name: 'A@B.com', photo: '', verified: false });
  assert.equal(userInfo({ email: 'a@b.com', emailVerified: true }).verified, true);
  assert.equal(userInfo({ email: 'a@b.com' }).verified, false, 'verified only when Firebase says so');
  assert.equal(userInfo(null), null);
}
console.log('email sign-in helpers ok');

// Firebase stays behind the adapter: only js/cloud.js loads the SDK or calls Firestore/Auth (and through it app-sync);
// every other page module reaches the cloud through the backend that cloud.js returns (store.js interface)
{
  const dir = new URL('../js/', import.meta.url);
  const sdk = /gstatic\.com\/firebasejs|from ['"]firebase|\b(getFirestore|getAuth|initializeApp|setDoc|getDocs?|addDoc|updateDoc|deleteDoc|onSnapshot|writeBatch|runTransaction|signInWith\w*|onAuthStateChanged|createUserWithEmailAndPassword)\s*\(|core\.anawj\.com\/sync\//;
  const others = fs.readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'cloud.js');
  assert.ok(others.includes('app.js') && others.includes('store.js'), 'the scan sees the page modules');
  for (const f of others) assert.ok(!sdk.test(fs.readFileSync(new URL(f, dir), 'utf8')), f + ' calls Firebase directly; go through cloud.js');
  assert.match(fs.readFileSync(new URL('cloud.js', dir), 'utf8'), /import\('@core\/sync'\)/, 'cloud.js saves through app-sync');
}
console.log('Firebase only behind cloud.js ok');
