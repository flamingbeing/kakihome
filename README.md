# kakihome

Kaki Home, a household inventory ("buy what you need, use what you own before it expires"), at
`kakihome.flamingbeing.com`. The app is in [`kakihome/`](kakihome/README.md); hosting in [HOSTING.md](HOSTING.md);
rules for assistants in [AGENTS.md](AGENTS.md). Built on the family home design kit
(`https://design.flamingbeing.com/v1/`).

- `kakihome/`: the app (static files, a service worker, Firebase for sign-in and sharing).
- `__/auth/`: Firebase's sign-in helper pages, served on the app's own address.
- `worker/`: the Cloudflare Worker that serves the files; `tools/`: checks, version stamp, proofreading.
