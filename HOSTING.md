# Hosting: kakihome.flamingbeing.com

One Cloudflare Worker, `kakihome` (`wrangler.jsonc`, `worker/sites.js`), serves this repo's files. Which folder the
address may see is the `SITES` table in `worker/routes.js`. GitHub Actions deploys it on every merge to `main`
(`.github/workflows/deploy.yml`, which stamps the service-worker version first). No data and no secrets in the Worker.

| Address | Folder | What |
|---|---|---|
| `kakihome.flamingbeing.com` | `kakihome/` (+ `/__/auth/` from `__/auth/`, `/__/firebase/` from `kakihome/auth/firebase/`) | Kaki Home |

- The design kit is not served here: pages link `https://design.flamingbeing.com/v1/` (another repo, any origin allowed).
- **Previews:** off (`preview_urls: false`, `workers_dev: false`); check a change locally or on the live address after
  merge. Sign-in never works on previews.
- Check a change to `.assetsignore`/`wrangler.jsonc` with `npx wrangler deploy --dry-run`.
- Keep app names one level deep (`kakihome.flamingbeing.com`): Cloudflare's free certificate covers only one level.
