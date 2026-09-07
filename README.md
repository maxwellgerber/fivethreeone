# Five Three One

A 5/3/1 Forever training log that runs as an installable web app on your phone. No accounts, no subscription, no server: everything lives in your browser's storage, and you can export a JSON backup any time.

## What it does

- Program engine for 5/3/1 Forever: leader/anchor phases, 5s PRO or PR sets, FSL / SSL / BBB supplemental, 7th-week deload or TM test, per-cycle TM increments, warm-ups, rounding, plate math.
- Gym logging built for one thumb: tap a set to log it, PR/TM-test sets open a rep stepper with a "reps to beat your best e1RM" hint, a rest timer starts automatically (3:00 main / 1:30 supplemental / 1:00 assistance by default) with sound and vibration, and the screen stays awake.
- Assistance tracked against the phase's push / pull / single-leg-core rep targets.
- History with edit-as-text in the same shorthand as a notebook (`Squat 225x5, 175x5x5`), rep PRs, e1RM chart per lift, weekly tonnage.
- Import: paste freeform notes (years are inferred from date order) or restore a JSON backup.

## Develop

```
npm install          # esbuild + typescript
npm test             # engine + importer tests (node --test)
npm run typecheck
npm run build        # -> dist/
npm run build:seeded # also embeds public-history.json and writes dist/single.html
npm run serve        # preview on http://localhost:3000
```

`tools/import-notes.ts` converts a notes file to the app's JSON:

```
npm run import-notes -- notes.txt public-history.json
```

## Deploy to Cloudflare Workers

The Worker in `worker/index.ts` serves `dist/` as static assets and gates everything behind a login (cookie session, HMAC-signed, 30 days). Credentials are env vars for now; the `/login` route and `checkCredentials()` are the two places to replace when wiring up an OpenID provider.

```
npm install
npx wrangler login
npx wrangler secret put AUTH_PASS        # maxwell1234 for now
npx wrangler secret put SESSION_SECRET   # openssl rand -hex 32
npm run deploy                           # builds dist/ then wrangler deploy
```

`AUTH_USER` lives in `wrangler.toml` (`maxwell`). For local dev, `.dev.vars` holds the two secrets and `npm run dev` runs the Worker at http://localhost:8787.

Then open the workers.dev URL (or a custom domain) in Safari on iOS, sign in, Share → Add to Home Screen. The service worker makes it work offline after the first load; `/login`, `/logout` and `/whoami` are never cached.

Data is stored in IndexedDB for the origin you load it from, so keep one URL. Export a backup from Program → Your data before moving hosts. (A sync layer via KV/D1 is the obvious next step now that there's a Worker in front.)
