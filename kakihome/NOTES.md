# Kaki Home: notes

Lasting decisions and how to test. Now: [STATUS.md](STATUS.md). Setup: [SETUP.md](SETUP.md). Trying it: [TRY.md](TRY.md).

## Decisions

- **16 Oct 2026, feature freeze:** no new features; fixes only, when asked. Each person who signs in starts their own
  household; the rules keep households apart. (Who it is shared with: the owner's private notes.)

- **16 Oct 2026, a separate app** Kaki Home tries out a product idea and stays apart from the family pantry:
  own subdomain (`kakihome.flamingbeing.com`), own IndexedDB and localStorage names (`kakihome`), own cache prefix
  (`kakihome-`), own Firebase project. Started as a copy of `pantry/` (16 Oct, after the pantry's welcome PR); the two
  are now separate code. Lessons that apply to both go to the pantry as their own PR.
- **No AI** (16 Oct). The idea's "zero manual entry" is approximated with what a phone
  does on its own: barcode scan (Open Food Facts), the catalogue (which also gives the "suggested storage location"),
  and **Say or type** (`js/quick.js`): the phone's speech-to-text (Web Speech API where the browser has it, otherwise
  the keyboard's microphone), then plain rules pick out quantity, place and date and match the rest against the
  household's items and the catalogue. Nothing leaves the phone. Everything is shown to confirm before it's added.
- **The main measure** (the product idea's North Star, "household waste prevented"): **used before expiry**, units used
  up while their batch was still in date (dated batches only), counted on the event as `saved` when it happens
  (`takeOut` in `logic.js`). Binning a batch already past its date is recorded as type `expired`, apart from other
  throwing away (`discard`); both count as wasted. Old events without these fields simply count as before.
- **Home** shows the idea's dashboard: tiles for items at home, expiring soon, low in stock and added this week,
  then the used-before-expiry card, then Expired, Use soon, Opened, Running low, Recently added and This month.
- **Expiring soon** is a per-phone setting (3 days, 1 week, 2 weeks; default 1 week). Low stock stays per item ("on
  the list when down to").
- **Who changed what:** items carry `createdBy` and `updatedBy` (the name from Settings, or the Google first name);
  every event already had `by`. Shown in the item's details, its history and Recently added.
- **Demo `?demo`** is a made-up household of three (Mum, Dad, Helper) with months of history, so the measures and
  "who" have something to show.
- **Not built (needs a server or AI):** push reminders, photo or receipt reading, learned recommendations, linked
  households and roles (the idea's release 2).
- **Hands-on first steps** (16 Oct, same as the pantry's; `js/tour.js`): a two-card welcome ending at a quick start
  ("What do you have?": everyday goods as chips, added with a rough best-before date) and a Getting started
  checklist on Home whose steps tick themselves off, each with Show me. Only for new users or when turned on in
  Settings → Help.
- **Names for household members** (16 Oct, for the pantry and Kaki Home alike): tap a person in
  Settings → Household sharing for their card: Gmail, a Name everyone in the household sees, Email an invite, Stop
  sharing (not for whoever started it, nor yourself). The list shows the name with the email under it, or the email
  alone. Names live with the household's data in Firestore, never in the repo:
  `households/{hid}/settings/people` = `{ id: 'people', names: { email: name }, updatedAt }` (a new `settings` kind).
  Rules: members only; writes only to `people`, only those fields, at most 20 names; the app trims names to 40
  characters (rules can't loop over a map). The name the household gives you is also what your changes are signed
  with ("added by", history, shopping list). No default places in Kaki Home (that's the pantry's).
- **Photos cost fix** (16 Oct; the pantry's #26, ported): every item keeps a ~96px
  thumbnail (`thumb`, `hasPhoto`, a few KB) for lists, rows and Home; the ~480px photo lives in
  `households/{hid}/photos/{itemId}` and is read only when the item is opened (never listened to). So opening the app
  downloads thumbnails, not photos: many people attaching many photos can't use up the free 10 GB a month of Firestore
  downloads. Rules: members only; thumb at most 12 KB; photo data at most 150 KB; no item may gain a `photo` field.
  Older items with a whole photo inside (none exist yet) would move by themselves. Backups include the photos.
- **Email sign-in and one household per account** (16 Oct; the pantry's #31, ported; Email/Password with email link
  must be switched on in the Firebase project): Settings has "Continue with Google" and, under it,
  "Use email instead": an emailed sign-in link, or email + password (Create account, Forgot password). A new password
  account must tap the emailed verification link before it sees anything (the rules already need a verified email), and
  "I've verified" carries on. An emailed link opened in another browser (iPhone Safari instead of the home-screen app)
  asks for the address once. Firebase's default sender allows roughly 100 emails a day, so it suits a trial, not a
  crowd.
  **One household per account:** the lookup asks the server, never the phone's copy (offline it says "Can't check
  right now", with no Start button), creating is a server-only transaction and ignores a double tap, an account in
  several households opens the one this phone used last (else the biggest), and Settings offers one-tap **merge**
  (copies items, history, shopping, photos and names into the one kept, checks counts on the server, joins members up
  to 20, then deletes the others; any error stops with nothing deleted; only the owner of a household can merge it
  away). No rules change.
- **Data path on the shared sync engine** (25 Oct 2026; the pantry's pattern, `js/cloud.js`): app-sync `0.4.1` (exact pin,
  precached whole in `sw.js`) and the update module `0.2.0`. Every save goes to an outbox on the phone, then to the
  server in a transaction (`updatedAt` as an ISO string, stamped by the engine); each kind keeps a copy on the phone and
  listens only for what changed since its last sync, with a full read weekly (`unstamped: 'full'` until every document
  has `updatedAt`: events and shopping lines made before this had none). Saves replace the document as `setDoc` did (last
  write wins, no conflict screen). A delete writes an entry in `households/{hid}/bin` in the same transaction (rules:
  members only, fixed shape): a deleted document is not part of a "changed since" listener, so the entry is how other
  phones hear of it. The one `onSnapshot` left is the household document itself (members, "gone"). `put` returns
  true once the save is kept on the phone; a refusal comes through `onError`. The status line on Home follows the engine
  (`syncStatus`, `confirmed` only after a snapshot from the server): Saving N changes, Offline, Needs attention,
  Checking with the household. Sign-out is `forgetDevice` (refuses while saves are unsent; wipes the copy, the outbox
  and the SDK cache, then the page reloads). The reload after an update waits while a form or sheet is open or saves are
  being sent (`canReload`). `merge.js` is the household merge (two households of one account), not the engine's merge.
  Photos stay one document per item, read when the item is opened, written through the same queue.
- Everything else as in the pantry's `NOTES.md` (repo `flamingbeing/pantry`) (stock as batches, undo over confirm, a household member's change never
  wipes what someone is typing, sign-in on the app's own address, the service worker waits to take over, rules deploy
  on merge with the `KAKIHOME_FIREBASE_PROJECT` variable).

## How to test

```
node kakihome/test/logic.test.mjs      # logic, measures, catalogue, backups
node kakihome/test/quick.test.mjs      # Say or type: dates, places, quantities, matching
node kakihome/test/tour.test.mjs       # first steps: quick-start list, checklist ticks
node kakihome/test/photo.test.mjs      # photo sizes: the thumbnail and photo limits
node kakihome/test/merge.test.mjs      # merging duplicate households: who may, members, names
node kakihome/test/config.test.mjs     # set-config, sign-in choice, plain-word errors, sw.js rules, the engine and update pins
npx playwright test                    # the browser specs (below); SHOTS=<dir> saves screenshots
```

The browser specs are Playwright Test (`playwright.config.mjs`, `kakihome/test/specs/`): `app` (the phone walk-through,
split into independent tests), `welcome` (welcome, guide, first steps), `demo` (every screen at 390/360/320 px), `photos`,
`signin` (email sign-in), `engine` (the outbox, the delete feed, the status line, sign-out) and `sync` (household sharing, photos rules, names, merging, offline: the rules in the local
emulators, project `demo-kakihome`, fake accounts). Run one with `npx playwright test sync`; `PW_NO_EMULATOR=1` skips
starting the emulators for the specs that don't need them (`app`, `welcome`, `demo`, `photos`).
Rules for specs: fully parallel, retries 0 (a flake is a bug to fix); every test gets its own static server (a fresh origin)
and a `uid` that goes in every email and household id it makes, so no test leaves anything another one needs; no fixed
waits: wait on what the page shows (`expect(...)`, `expect.poll`). Service workers are blocked in `open()` (on a first visit
the app reloads itself once when its worker claims the page); the one test about the worker allows them. If the emulators
fail to start, a stray one from an earlier run may still hold port 8085: `pgrep -f '[c]loud-firestore-emulator'`, then kill it.

The "Kaki Home checks" workflow runs them on PRs touching `kakihome/` or `__/`; they load the design kit from its live address. Never point a test at the
live Firebase project.
