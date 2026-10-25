# Kaki Home: status

## Now
- Feature freeze: fixes only, when asked. Household sharing, email sign-in, photo thumbnails, names and the walkthrough are in.
- Install (23 Oct 2026): manifest `id` set to the id Chrome already computes (`./`, so installs carry on), maskable
  icon and a 32 px PNG favicon from the shared app icon set (Home family; same design as before).
- Browser tests moved to Playwright Test (23 Oct 2026): `npx playwright test`, 48 independent specs (`kakihome/test/specs/`),
  fully parallel with their own accounts and households, no fixed waits; emulators started by the config. The old scripts
  (`e2e.mjs`, `sync.e2e.mjs`, `signin.e2e.mjs`, `run-sync.sh`) are gone; how to run: [NOTES.md](NOTES.md). Found on the way:
  on a first visit the service worker claims the page and the app reloads itself once (`controllerchange` in `app.js`), which
  made the old script's first check fail every time; specs block service workers except the one that tests them.
- Nothing is waiting on the owner. Decisions and plans: the owner's private notes. Technical decisions: [NOTES.md](NOTES.md).
- 25 Oct 2026: data path on app-sync 0.4.1 + update module 0.2.0 (outbox, changed-since listeners, delete feed, status line,
  `forgetDevice` at sign-out, no reload mid-edit); details in [NOTES.md](NOTES.md). The rules gain a `bin` collection
  (additive; deployed on merge). Left: events and shopping lines made before this carry no `updatedAt`, so opens read in
  full until a one-off backfill stamps them (not run; the app works the same, only the reads differ).
- 25 Oct 2026: Firebase stays behind `js/cloud.js`: a test in `test/config.test.mjs` fails if any other page module loads
  the SDK, calls Firestore or Auth, or imports app-sync itself (none does today; nothing in the app changed).
- 25 Oct 2026: app-sync 0.6.0; `js/cloud.js` hands its engine wiring to one `createApp` call (about 90 lines fewer, no
  behaviour change; all 47 specs green). Details in [NOTES.md](NOTES.md).
