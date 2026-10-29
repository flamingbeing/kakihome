# Status (repo)

## Now
- Moved here from the family home apps repo (22 Oct 2026): own repo, own Worker `kakihome`, deploy from Actions.
  The app's own status: `kakihome/STATUS.md`.
- 23 Oct 2026: browser and emulator tests are Playwright Test specs (`npx playwright test`, CI job `specs`); details in
  `kakihome/STATUS.md`.
- 25 Oct 2026: data path moved to app-sync 0.4.1 and update 0.2.0 (`kakihome/NOTES.md`).
- 28 Oct 2026: app-sync 1.4.0 (`auth()` + `sync()` modules) and the UI kit pins (`@core/ui`, `@core/theme`, look A, pinned
  rc.16): theme, look and density in Settings > This device, kit confirm dialogs. Screens still on the home kit (`ha-*`):
  Home, Items, Shopping, Settings, sheets. Service-worker list: `node tools/sw-files.mjs kakihome`. Screens:
  `docs/m2-screens/`.
- 28 Oct 2026: UI kit rc.25; the kit toaster (`--ui-toast-bottom` above the tab bar) and the kit conflict sheet (field
  labels in words) replace the app's own. Before/after: `docs/m2p2-screens/`.
- 28 Oct 2026: UI kit rc.29; screen content (lists, rows, sections, cards, stats, badges, chips, empty states, buttons)
  on the kit's content parts. Still on the home kit (`ha-*`): the shell (bar, large titles, tab bar), sheets and form
  fields. Before/after: `docs/m2p2-screens/cmp-*.png`.
- 29 Oct 2026: UI kit rc.42; Back with tabs, as Android apps do it: a tab change adds at most one Back step (the kit's
  `tabBack`), so Back on another tab goes to Kaki Home and Back there leaves the app; screens and sheets still close
  first. Every tab change goes through `goTab` in `js/app.js`, which first steps back past screens and sheets open over
  the tab. Tests: `back.spec.mjs`; all 54 specs green.

## Waiting on the owner
-

## Next (in order)
1. Keyless rules deploy set up, then the first deploy run of `deploy-firestore-rules.yml` confirmed.

## Decisions (dated, one line each)
- 22 Oct 2026: own repo (a webapp gets its own repo unless it shares code, sign-in or data); design kit linked from
  `design.flamingbeing.com/v1/`, never copied.
