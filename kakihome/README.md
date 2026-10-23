# Kaki Home

A household inventory at `kakihome.flamingbeing.com`: what's at home, what's expiring, what's low, who added what, and
how much gets used before its date. Built to try out a product idea ("know what you have,
buy what you need, use what you own before it expires"), apart from the family pantry: its own address, data and
Firebase project. A phone app (installable PWA) on the home design kit (`https://design.flamingbeing.com/v1/`), started as a copy of
the family pantry (repo `flamingbeing/pantry`).

Start with [NOTES.md](NOTES.md) (decisions, how to test); setup is [SETUP.md](SETUP.md); what's happening now is
[STATUS.md](STATUS.md); how to try it and what it measures is [TRY.md](TRY.md).

| Path | What |
|---|---|
| `index.html`, `kakihome.css` | The shell (bar, tab bar, toolbar) and the app's own `kh-` styles on top of the kit |
| `js/app.js` | Screens (hash routes via the kit's `haRouter`), sheets, clicks, data sources, updates |
| `js/logic.js` | Pure logic: dates, batches (first expiring first out), used-before-expiry and expired, usage pace, run-out, shopping list, search, CSV, backups |
| `js/quick.js` | "Say or type": a sentence becomes items (quantity, place, date, catalogue match); the phone's speech-to-text |
| `js/catalogue.js` | About 190 common Singapore supermarket goods, each with its usual place |
| `js/store.js` | This phone's data (IndexedDB), the demo's (memory) and small per-phone settings |
| `js/cloud.js` | Household sharing: Google sign-in and the household in Firestore (only with a config) |
| `js/scan.js`, `js/photo.js`, `js/sample.js`, `js/guide.js` | Barcodes and Open Food Facts, photos, the made-up demo household, the welcome and the guide |
| `config.js`, `auth/firebase/init.json` | The Firebase web config (null until set up: on-phone only); written by `tools/set-config.mjs` |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline support and the home-screen icon (`tools/icons.mjs` renders the PNGs) |
| `firestore.rules`, `firebase.json` | Members-only households; deployed on merge by `.github/workflows/deploy-firestore-rules.yml` |
| `test/` | `logic`, `quick`, `config` (plain node), `specs/*.spec.mjs` (Playwright Test: phone browser tests and the emulator tests, `npx playwright test`) |

Try it without any account: `<preview>/_sites/kakihome.flamingbeing.com/?demo` (a made-up household, nothing saved),
or `https://kakihome.flamingbeing.com/?demo` once live.
