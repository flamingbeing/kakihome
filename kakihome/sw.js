// Kaki Home offline support, on the shared update module (app-update 0.2.0: sw-core.js does the work; its README
// has the rules). The deploy stamps VERSION and MANIFEST (tools/stamp-versions.mjs: 'kakihome-v5' becomes
// 'kakihome-<date>-<hash>' from every file the app serves, MANIFEST a hash per SHELL file); never change them by
// hand. Change the v<N> only when this file's own logic changes.
//
// - Install: every SHELL file or nothing, only changed files fetched. A new version takes over at once and the open
//   page reloads once, but not while someone is typing, a sheet is open or changes are being sent (js/app.js
//   registers through register.js with canReload).
// - Activate: deletes only this app's old caches (names starting 'kakihome-'; 'kakihome-rt-*' are kept).
// - Fetch: SHELL files and pages cache-first; the design kit (design.flamingbeing.com/v1/) and the app's other files
//   once fetched (refreshed in the background), the Firebase SDK (gstatic, versioned) and the barcode reader
//   (jsDelivr, versioned) once fetched, so sharing and scanning keep working with no signal. Firebase's sign-in pages
//   (/__/), sw.js itself and everything else (Firestore, Google, Open Food Facts) always go to the network.
const VERSION = 'kakihome-v5';
const SHELL = [
  './',
  'kakihome.css',
  'manifest.webmanifest',
  'config.js',
  'js/app.js',
  'js/logic.js',
  'js/catalogue.js',
  'js/store.js',
  'js/sample.js',
  'js/cloud.js',
  'js/scan.js',
  'js/guide.js',
  'js/photo.js',
  'js/quick.js',
  'js/tour.js',
  'js/merge.js',
  'icons/icon.svg',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'https://design.flamingbeing.com/v1/tokens.css',
  'https://design.flamingbeing.com/v1/app.css',
  'https://design.flamingbeing.com/v1/app.js',
  'https://design.flamingbeing.com/v1/icons.svg',
  // the page side of app-update and the sync engine (one exact version each), so the app opens offline
  'https://core.anawj.com/update/0.2.0/register.js',
  'https://core.anawj.com/sync/0.4.0/index.js',
  'https://core.anawj.com/sync/0.4.0/src/sync.js',
  'https://core.anawj.com/sync/0.4.0/src/writes.js',
  'https://core.anawj.com/sync/0.4.0/src/conflict.js',
  'https://core.anawj.com/sync/0.4.0/src/store.js',
  'https://core.anawj.com/sync/0.4.0/src/outbox.js',
  'https://core.anawj.com/sync/0.4.0/src/watchdog.js',
  'https://core.anawj.com/sync/0.4.0/src/persist.js',
  'https://core.anawj.com/sync/0.4.0/src/status.js',
  'https://core.anawj.com/sync/0.4.0/src/firestore.js',
  'https://core.anawj.com/sync/0.4.0/src/forget.js',
];
const MANIFEST = {};

importScripts('https://core.anawj.com/update/0.2.0/sw-core.js');
AppUpdate.init({
  app: 'kakihome', version: VERSION, shell: SHELL, manifest: MANIFEST,
  never: [/\/sw\.js$/],
  runtime: [
    { name: 'kit', match: 'https://design.flamingbeing.com/v1/', strategy: 'stale-while-revalidate', max: 40 },
    { name: 'pinned', match: /^https:\/\/core\.anawj\.com\/(sync|update)\/\d+\.\d+\.\d+\//, strategy: 'cache-first', max: 40 },
    { name: 'cdn', match: /^https:\/\/(cdn|fastly)\.jsdelivr\.net\/npm\/[^/]+@\d/, strategy: 'cache-first', max: 20 },
    { name: 'files', match: url => url.origin === self.location.origin && /\.(m?js|css|json|png|svg|jpe?g|webp|ico|woff2?|webmanifest)$/i.test(url.pathname), strategy: 'stale-while-revalidate', max: 60 },
  ],
});
