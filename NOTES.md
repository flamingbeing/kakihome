# Notes

Lasting rules and lessons for the repo as a whole; the app's own notes and how to test are in `kakihome/NOTES.md`.

- **Design kit by URL (22 Oct 2026):** browsers refuse SVG `<use>` across addresses, so the kit's `app.js` puts its
  icon sprite into the page when it is loaded from another address; static icons write `<use href="#i-<name>"/>`.
  The service worker keeps the kit cache-first like the CDN files. Browser tests load the live kit.

## 28 Oct 2026: app-sync 1.4.0 and the UI kit
- Data: `kakihome/js/cloud.js` builds one `createApp` with `[auth(), sync()]`; the app keeps its own data, rules and merge.
- Pins in `kakihome/index.html` (import map): `@core/app|auth|sync` 1.4.0, `@core/ui|theme|settings` 1.0.0-rc.25. After changing a pin, run `node tools/sw-files.mjs kakihome` to regenerate the service-worker list.
- Theme: `js/boot.js` applies the kit theme; `kakihome.css` bridges the `--home-*` tokens to the kit tokens (guarded by `html[data-look]`).
- Own conflict sheet kept: the kit one shows raw field paths and has no field labels.
