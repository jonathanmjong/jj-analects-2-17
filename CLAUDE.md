# Analects 2.17 — Project Reference

A multi-factor stock ranking/screening SaaS (mid/large-cap equities), scored on ~70 fundamental
metrics across valuation, momentum, profitability, growth, financial strength, capital allocation,
efficiency, earnings quality, and moat. $2/month, 7-day trial, Stripe-billed.

**Live:** https://analects2.com (custom domain) / https://jj-analects-2-17.web.app (Firebase default)
**Firebase project:** `jj-analects-2-17`

This file is both the working reference for this repo and a template for future similar builds —
see "Reusable patterns" and "Gotchas" below if you're starting a new Firebase+Vite+React SaaS from
scratch.

## Stack

**All-Firebase, no separate backend.** Chosen specifically to avoid a Python/Postgres/Celery/Docker
stack for a solo-maintained SaaS — Cloud Scheduler + Cloud Functions replace Celery, Firestore
replaces Postgres, Firebase Hosting replaces Vercel/Railway.

- **Frontend:** Vite + React 19 + TypeScript, Tailwind CSS v4, hand-rolled shadcn-style UI
  primitives (no component library dependency), TanStack Table + TanStack Query, Recharts, React
  Router, `oxlint`, Vitest.
- **Backend:** Firebase Cloud Functions v2 (Node 22), TypeScript bundled with esbuild. Scheduled
  functions (Cloud Scheduler) run ingestion/ranking; callable functions handle billing and
  on-demand recompute; an Express app serves CSV/JSON exports.
- **Database:** Firestore. Security model is a single custom Auth claim (`subscribed`, set by the
  Stripe webhook) gating nearly everything — see `firestore.rules`.
- **Storage:** Firebase Storage, one object (`public/ranking-universe.json.gz`) — a gzipped bulk
  export the frontend fetches once per session to recompute rankings client-side instead of
  round-tripping to a Cloud Function on every UI interaction. Gated by `storage.rules` the same way
  Firestore is.
- **Billing:** Stripe Checkout + Billing Portal + webhook → Firebase custom claim.
- **Auth:** Firebase Auth, Google provider only.
- **Monorepo:** npm workspaces — `shared` (types + pure math shared between frontend and
  functions), `web`, `functions`.

## Repo structure

```
shared/src/       Types + pure functions used by BOTH web/ and functions/ (see below)
functions/src/
  admin/          Admin-only callables (email-allowlist gated)
  api/            Express app for CSV/JSON exports
  billing/        Stripe checkout/portal/webhook
  ingestion/      Pulls fundamentals/prices from providers into Firestore
  metrics/        ~70 metric calculators + registry (definitions.ts)
  providers/      FinancialDataProvider abstraction (Yahoo Finance, SEC EDGAR live; 4 more stubbed)
  ranking/        Cross-sectional ranking engine, bulk export for the client engine
  scheduled/      Cloud Scheduler-triggered jobs (nightly ingestion, ranking, cleanup)
web/src/
  components/     UI primitives (ui/), layout (Shell, RequireSubscription), charts, landing/marketing
  context/        AuthProvider (Firebase Auth + subscribed claim)
  hooks/          Data-fetching (TanStack Query) and page-state hooks
  lib/            Firebase client init, client-side ranking engine, formula filter, exporters
  pages/          One file per route
```

## Commands

```bash
npm install
npm run build:shared     # must run before build:functions/build:web pick up shared changes
npm run dev:web          # Vite dev server
npm run emulators        # Firebase emulators (auth, firestore, functions, hosting, storage)
npm test                 # Vitest: shared + functions + web
npm run test:e2e         # Playwright smoke tests
npm run lint             # oxlint across web, functions and shared (root devDependency)
npm run typecheck -w web # tsc -b --force. NOT `tsc --noEmit`: web/tsconfig.json is a
                         # project-references root with "files": [], so --noEmit silently
                         # checks ZERO files and exits 0 no matter what is broken.
                         # (npm run build:web does run the real check — it is `tsc -b && vite build`.)
```

## Deploy — CI/CD only, never `firebase deploy` directly from an agent session

`.github/workflows/ci-cd.yml`: build+test+e2e on every push/PR; on push to `main`, deploys
`hosting,functions,firestore,storage` via a scoped service account
(`github-actions-deploy@jj-analects-2-17.iam.gserviceaccount.com`). This is a hard rule for this
repo, established because `main` auto-deploys to production and every change should go through the
same tested path a human's push would. If you need to force a redeploy with no code change (e.g.
after rotating a secret), use `gh run rerun <run-id>` on the last successful run — not a bypass.

## Reusable patterns worth carrying into a new project

- **`shared/` isn't just types.** Once server and client both need to run the *same computation*
  (see client-side ranking engine below), the pure algorithm belongs in `shared/`, imported by both
  sides, so they can never silently diverge. Don't reimplement it twice "for now."
- **Client-side compute over server round-trips for interactive UI.** The Rankings page's live
  weight sliders used to call a Cloud Function on every change (~25s at this data scale). Fixed by:
  nightly job exports a compact bulk snapshot (shared metric-key list + parallel numeric arrays,
  not repeated key strings) to Storage, gzipped; the browser fetches it once per session and reruns
  the *identical* `shared/` ranking algorithm locally (sub-second for ~1,300 companies). The server
  export write is wrapped in try/catch and never blocks the job's real Firestore writes — a
  performance optimization must never become a hard dependency of the system of record.
- **Cross-session client caches must be cleared on sign-out.** Any module-scope cache or
  "persist across route navigation" state (see `usePageState`) is *not* automatically scoped to a
  user identity. Wire a clear-all into the auth state change handler (on the uid actually changing,
  not just on the manual sign-out button) — otherwise a second user on the same tab inherits the
  first user's cached filters and Storage-gated data.
- **Firestore rules: carve out specific-path exceptions before the wildcard.** A rule like
  `match /rankings/preview { allow read: if true; }` declared before `match /rankings/{docId}`
  makes that one document public while everything else in the collection stays gated — Firestore
  matches the most specific path.
- **Storage rules mirror the Firestore access model** (same `subscribed` claim check) rather than
  inventing a separate scheme — one mental model for "what's gated."
- **Admin ops: email allowlist, not a role system.** `ADMIN_EMAILS = ["you@example.com"]` checked
  in both the callable (`assertAdmin`) and the page (`<Navigate>` if not listed) is enough for a
  solo-founder SaaS — don't build a roles/permissions system before you need one.
- **Metric/provider registries are additive, not branching.** Adding a metric = one calculator
  function + one registry entry in `definitions.ts`; nothing else in the pipeline changes. Adding a
  data provider = implement `FinancialDataProvider`, swap one line in `providers/index.ts`. This
  pattern (a typed interface + a registry array + a single wiring point) is worth defaulting to
  whenever "one more of these" is a foreseeable future need.

## Gotchas hit in this project (save yourself the debugging time)

- **Firebase Storage needs manual first-time setup.** Enabling the `firebasestorage.googleapis.com`
  API (`gcloud services enable`) is not enough — the *default bucket* only gets provisioned by
  visiting the Firebase Console's Storage tab and clicking "Get started" once. `firebase deploy
  --only storage` fails with a clear "Firebase Storage has not been set up" error until this is
  done. No CLI/API workaround found.
- **Cloud Functions v2 secrets pin to a specific version at deploy time**, not "latest." Rotating a
  secret (`gcloud secrets versions add ...`) does nothing to a running function until you redeploy
  — confirmed via `gcloud run services describe --format="yaml(spec.template.spec.containers[0].env)"`
  showing `secretKeyRef.key` still pointing at the old version number post-rotation.
- **Cloud Functions v2 needs `allUsers:roles/run.invoker`** at the project or per-service IAM level,
  or callable/HTTPS functions silently fail for all callers — easy to miss since deploys succeed
  and the error only shows up as client-side "internal" errors.
- **Don't apply long/immutable Cache-Control to everything under `public/`.** Vite content-hashes
  build output (`dist/assets/*-[hash].js`), which is safe to cache forever — but static files
  copied verbatim from `public/` (favicon, og-image) keep a fixed filename and *can* change later.
  A blanket `**/*.@(js|css|svg|png|...)` immutable-cache hosting rule will make a future icon/image
  update invisible to any browser that already cached the old one, for up to the max-age. Split the
  rule: immutable only for hashed build output; short cache for static `public/` assets. Even then,
  a browser that cached the *old* filename before the fix won't revalidate — renaming the file is
  the only reliable way to force a bypass for already-visited browsers.
- **`getDownloadURL()` bypasses Storage security rules.** It mints a long-lived, shareable token
  that grants access to anyone with the URL forever, regardless of rules. For rules-gated reads, use
  the authenticated SDK calls (`getBytes`/`getBlob`) instead, which evaluate rules per-request.
  Easy to get this backwards since `getDownloadURL` is the more commonly-documented API.
- **Stripe webhook endpoints can't be created via API** with a restricted CLI key or the available
  Stripe MCP tools (`stripe_api_search` returns empty for "create webhook" in both this project's
  attempts) — has to be done manually in the Stripe Dashboard, then the signing secret piped into
  `gcloud secrets versions add` (never as a CLI arg — shell history/process listing exposure).
- **Cloud Scheduler manual triggers (`gcloud scheduler jobs run`) are unreliable** shortly after a
  fresh deploy — logs may not show a new invocation for 30–45s+ even when it did fire. Don't assume
  a missing log means it failed; check again after a longer wait, or wait for the natural schedule.
- **Domain changes need registrar-level DNS action an agent can't perform**, and domain
  registration itself needs a payment on an external registrar — both are on the user. Plan for a
  manual handoff: register the domain, add the TXT ownership-verification record Firebase Hosting
  generates, then the A/CNAME records. Once live, remember the domain also needs adding to Firebase
  Auth's authorized domains list (or Google Sign-In breaks on it) and to any hardcoded
  checkout/portal return URLs in Stripe.

## Conventions

- No comments unless they explain a non-obvious *why* (a workaround, a hidden constraint, a subtle
  invariant) — never restate what the code already says.
- Firestore/Storage security is the actual access boundary, not hiding client config — the Firebase
  web config (API key, project ID) is not a secret; don't treat it like one.
- Commit messages explain *why*, not *what* — the diff already shows what changed.
