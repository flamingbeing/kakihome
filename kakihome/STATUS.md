# Kaki Home: status

## Now
- Feature freeze: fixes only, when asked. Household sharing, email sign-in, photo thumbnails, names and the walkthrough are in.
- Install (23 Oct 2026): manifest `id` set to the id Chrome already computes (`./`, so installs carry on), maskable
  icon and a 32 px PNG favicon from the shared app icon set (Home family; same design as before).
- Browser tests moved to Playwright Test (23 Oct 2026): `npx playwright test`, 41 independent specs (`kakihome/test/specs/`),
  fully parallel with their own accounts and households, no fixed waits; emulators started by the config. The old scripts
  (`e2e.mjs`, `sync.e2e.mjs`, `signin.e2e.mjs`, `run-sync.sh`) are gone; how to run: [NOTES.md](NOTES.md). Found on the way:
  on a first visit the service worker claims the page and the app reloads itself once (`controllerchange` in `app.js`), which
  made the old script's first check fail every time; specs block service workers except the one that tests them.
  Left as is: `firestore.rules` line 3 still names `test/run-sync.sh` (a comment; touching the file would redeploy the rules).
- Nothing is waiting on the owner. Decisions and plans: the owner's private notes. Technical decisions: [NOTES.md](NOTES.md).
