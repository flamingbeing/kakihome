# Status (repo)

## Now
- Moved here from the family home apps repo (22 Oct 2026): own repo, own Worker `kakihome`, deploy from Actions.
  The app's own status: `kakihome/STATUS.md`.
- 23 Oct 2026: browser and emulator tests are Playwright Test specs (`npx playwright test`, CI job `specs`); details in
  `kakihome/STATUS.md`.
- 25 Oct 2026: data path moved to app-sync 0.4.1 and update 0.2.0 (`kakihome/NOTES.md`).
- 28 Oct 2026: app-sync 1.4.0 (`auth()` + `sync()` modules) and the UI kit pins (`@core/ui`, `@core/theme`, look A, pinned
  rc.16): theme, look and density in Settings > This device, kit confirm dialogs. Screens still on the home kit (`ha-*`):
  Home, Items, Shopping, Settings, sheets; the kit toaster waits on a tap-size fix in the kit. Service-worker list:
  `node tools/sw-files.mjs kakihome`. Screens: `docs/m2-screens/`.

## Waiting on the owner
-

## Next (in order)
1. Keyless rules deploy set up, then the first deploy run of `deploy-firestore-rules.yml` confirmed.

## Decisions (dated, one line each)
- 22 Oct 2026: own repo (a webapp gets its own repo unless it shares code, sign-in or data); design kit linked from
  `design.flamingbeing.com/v1/`, never copied.
