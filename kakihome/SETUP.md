# Setting up household sharing (once, about 20 minutes)

Without this Kaki Home works fully, but each phone keeps its own. These steps make one shared household that its members sign
into with Google. Nothing here goes in the repo except the web config (a public client ID, not a secret). Keep the
project id and who's in Kaki Home in the owner's private notes, not here.

1. **Cloudflare address.** First check `kakihome` isn't a name already used at home (ask the owner; see [HOSTING.md](../HOSTING.md)).
   The address comes from `routes` in `wrangler.jsonc` (the deploy on merge creates it); if it doesn't appear,
   Cloudflare → Workers & Pages → **flamingbeing-home** → Settings → Domains & Routes → Add → Custom domain:
   `kakihome.flamingbeing.com`. Open it on the phone: Kaki Home opens, empty.
2. **Firebase project.** <https://console.firebase.google.com> → Add project → a name such as `kakihome-app`
   (Google Analytics not needed).
3. **Blaze plan, with a budget alert.** Project settings → Usage and billing → Details → Modify plan → **Blaze**.
   Then in Google Cloud → Billing → Budgets & alerts → Create budget: this project, **US$5**, alerts at 50%, 90%, 100%.
   One family stays well inside the free quota (expected about US$0 a month; backups cost cents).
4. **Database.** Build → Firestore Database → Create database → location **asia-southeast1 (Singapore)** →
   production mode. (The rules arrive by themselves in step 9.)
5. **Daily backups.** Firestore → **Disaster recovery** (Backups) → Create schedule → **Daily**, keep **7 days** (needs
   Blaze). If the console doesn't offer it, ask Claude for the one-line `gcloud firestore backups schedules create`
   command to run in Cloud Shell.
6. **Google sign-in.** Build → Authentication → Get started → Sign-in method → **Google** → Enable (pick your support
   email) → Save. Then Authentication → Settings → **Authorised domains** → Add `kakihome.flamingbeing.com`.
   Never add a `*.workers.dev` preview address: previews can't sign in, on purpose.
7. **The Google sign-in client** (so sign-in can finish on Kaki Home's own address). Google Cloud console
   (<https://console.cloud.google.com>, same project) → APIs & Services → Credentials → **Web client (auto created by
   Google Service)** →
   - Authorised JavaScript origins: add `https://kakihome.flamingbeing.com`
   - Authorised redirect URIs: add `https://kakihome.flamingbeing.com/__/auth/handler`
   → Save. (OAuth consent screen: app name "Kaki Home", your email; it can stay in Testing if you add the family's Gmail
   addresses as test users, or publish it: only basic profile and email are asked for.)
8. **Web app config → Claude.** Project settings (gear) → Your apps → Web (`</>`) → nickname `kakihome` → Register (no
   Firebase Hosting). Copy the `firebaseConfig = { … }` it shows and send it to Claude, who runs
   `node kakihome/tools/set-config.mjs '<config>'` (it writes `kakihome/config.js` and `kakihome/auth/firebase/init.json`
   with `authDomain: "kakihome.flamingbeing.com"`) and opens a PR.
9. **Rules deploy on merge.** The workflow `.github/workflows/deploy-firestore-rules.yml` deploys
   `kakihome/firestore.rules` whenever it changes on `main`. It signs in without a key (Workload Identity Federation)
   as a rules-deployer service account with **Firebase Rules Admin** on this project, set up once by the owner's admin
   route (details in the owner's private notes), which also sets the repo variables `FIREBASE_PROJECT`,
   `WIF_PROVIDER` and `RULES_DEPLOYER`. Until all three are set, the workflow skips with a notice instead of failing.
10. **On your phone.** Open `https://kakihome.flamingbeing.com` → Settings → **Sign in with Google** → **Start our
    household** → add each household member's Google (Gmail) address. If you had added items on that phone before, tap
    "Copy … from this phone". Household members open the same address and sign in; they see Kaki Home straight away.
    Then Add to Home Screen (Settings shows how).
