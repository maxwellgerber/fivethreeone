# Five Three One

A 5/3/1 Forever training log that runs as an installable web app on your phone. Everything lives in your browser's storage and works offline; behind the Cloudflare Worker it also syncs between your devices, and you can export a JSON backup any time.

## What it does

- Program engine for 5/3/1 Forever: leader/anchor phases, 5s PRO or PR sets, FSL / SSL / BBB supplemental, 7th-week deload or TM test, per-cycle TM increments, warm-ups, rounding, plate math.
- Joker sets: when a phase allows them and the PR set hits its target, the lift offers a joker set (5% of TM above the top set, same reps), one at a time, with a way to remove it if it was a mistake.
- Gym logging built for one thumb: tap a set to log it, PR/TM-test sets open a rep stepper with a "reps to beat your best e1RM" hint, a rest timer starts automatically (3:00 main / 1:30 supplemental / 1:00 assistance by default) with sound and vibration, and the screen stays awake.
- Assistance tracked against the phase's push / pull / single-leg-core rep targets.
- History with edit-as-text in the same shorthand as a notebook (`Squat 225x5, 175x5x5`), rep PRs, e1RM chart per lift, weekly tonnage.
- Import: paste freeform notes (years are inferred from date order) or restore a JSON backup.
- Sync: when served by the Worker, every change is pushed to a per-user KV document and pulled on launch and when the app returns to the foreground. Conflicts merge per workout (newest edit wins, deletes are tombstoned); program and settings are last-writer-wins. Status and a "Sync now" link live under Program → Your data.

## Develop

React 19 + TypeScript, bundled by esbuild (no framework CLI). Pure logic lives in plain modules and is unit-tested with Node's built-in runner; React only owns rendering and per-sheet UI state.

```
src/engine.ts        5/3/1 math: percentages, TM, e1RM, plates, phase/cycle/week/day position
src/model.ts         types + defaults
src/notesImport.ts   freeform notes -> workouts ("Squat 225x5, 175x5x5", years inferred)
src/workoutText.ts   workouts -> notebook text, summaries
src/stats.ts         PRs, e1RM series, tonnage
src/store.ts         IndexedDB persistence, JSON export/import, seed history
src/merge.ts         conflict-free merge of two app states (sync); tombstones expire after a year
src/sync.ts          sync client (pull on boot/foreground, debounced push, 409 -> merge -> retry); createSyncClient(deps) is unit-tested with a fake server
src/app/             React shell: store context (commit/replace), sheet, toast, rest timer, sync status, wake lock
src/components/      Stepper, Field, NumInput
src/screens/         Today, History, Progress, Program
worker/index.ts      Cloudflare Worker: login, static assets, /api/state
```

State changes go through `commit(mutator)` from `useStore()`: the mutator runs on a structured clone, the result is persisted (debounced) and queued for sync.

```
npm install          # react, esbuild, typescript, wrangler
npm test             # engine, importer and sync-merge tests (node --test)
npm run typecheck    # app + worker
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
npx wrangler kv namespace create SYNC    # paste the id into wrangler.toml [[kv_namespaces]]
npx wrangler secret put AUTH_PASS        # maxwell1234 for now
npx wrangler secret put SESSION_SECRET   # openssl rand -hex 32
npm run deploy                           # builds dist/ then wrangler deploy
```

### Sync API

`worker/index.ts` exposes one document per signed-in user in the `SYNC` KV namespace:

| Route | Behaviour |
| --- | --- |
| `GET /api/state` | `{ rev, updatedAt, state }`, or 404 `{ rev: 0 }` before the first push |
| `PUT /api/state` | body `{ baseRev, state }`; 200 `{ rev }` on success, 409 with the current document if `baseRev` is stale |
| `DELETE /api/state` | wipe the server copy |

The client (`src/sync.ts`) merges a 409 with `src/merge.ts` and retries, so two devices editing at once converge without losing either side's work.

## CI/CD

`.github/workflows/ci.yml` runs tests, typechecks and the build on every push and pull request. Pushes to `main` then deploy with `wrangler deploy`; that job needs two repository secrets (Settings → Secrets → Actions), ideally scoped to a `production` environment:

- `CLOUDFLARE_API_TOKEN`: an API token with the "Edit Cloudflare Workers" template plus Workers KV Storage: Edit.
- `CLOUDFLARE_ACCOUNT_ID`: from the Workers overview page in the dashboard.

The deploy also needs the real KV namespace id in `wrangler.toml`; `wrangler dev` runs fine against the placeholder.

`AUTH_USER` lives in `wrangler.toml` (`maxwell`). For local dev, `.dev.vars` holds the two secrets and `npm run dev` runs the Worker at http://localhost:8787.

Then open the workers.dev URL (or a custom domain) in Safari on iOS, sign in, Share → Add to Home Screen. The service worker makes it work offline after the first load; `/login`, `/logout` and `/whoami` are never cached.

Data is stored in IndexedDB for the origin you load it from and mirrored to KV through the Worker, so a fresh device picks up your history after signing in. Export a backup from Program → Your data before moving hosts.
