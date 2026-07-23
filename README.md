# Analects 2.17

> "When you know a thing, to hold that you know it; and when you do not know a thing, to allow that you do not
> know it — this is knowledge." — Analects 2.17

A multi-factor investment ranking platform for mid and large-cap equities: valuation, profitability, growth,
financial strength, capital allocation, and earnings quality, scored and ranked across every company in the
universe.

**Live:** https://jj-analects-2-17.web.app
**Firebase project:** `jj-analects-2-17`

## Architecture

This is an **all-Firebase** stack (no separate Python/Postgres backend):

- **Frontend:** Vite + React 19 + TypeScript, Tailwind CSS v4, hand-rolled shadcn-style UI primitives, TanStack
  Table, Recharts, TanStack Query, React Router, Firebase Auth/Firestore/Functions client SDKs. Deployed to
  Firebase Hosting.
- **Backend:** Firebase Cloud Functions (Node 22, 2nd gen), written in TypeScript, bundled with esbuild.
  - Scheduled functions (Cloud Scheduler) run ingestion, statement refresh, S&P 500 membership sync, and the
    ranking engine.
  - Callable functions handle checkout/billing-portal creation and on-demand rankings recompute.
  - An HTTPS Express app (`api`) serves CSV/JSON exports of the full ranked universe.
- **Database:** Firestore (`companies`, with `marketData`/`incomeStatements`/`balanceSheets`/`cashFlowStatements`/
  `historicalMetrics`/`metricScores` subcollections; `rankings/latest/companies`; `historicalRankings`;
  `metricDefinitions`; `dataRefreshLogs`; `users`). See `firestore.rules` for the access model.
- **Caching:** Firestore's own read caching + TanStack Query on the client stand in for the originally-specified
  Redis layer, consistent with the all-Firebase architecture decision. Heavy computation (metric scoring, ranking)
  runs in scheduled background functions, not on the request path — see `functions/src/scheduled/`.
- **Billing:** Stripe Checkout (subscriptions, 7-day trial) + Billing Portal + webhook, gating access via a
  Firebase Auth custom claim (`subscribed`) set from the user's Stripe subscription status.
- **Auth:** Firebase Auth, Google provider only.
- **Monorepo:** npm workspaces — `shared` (types shared between frontend and functions), `web`, `functions`.

### Why not Next.js / FastAPI / Postgres / Celery / Docker / Railway?

The original spec listed that stack, but the final instruction in the request explicitly simplified it to
"firebase, vite typescript, tailwind, latest LTS of node" — this repo follows that later, more specific
instruction. Cloud Scheduler + Cloud Functions replace Celery; Firestore replaces PostgreSQL; Firebase Hosting
replaces Vercel/Railway/Docker.

## The `FinancialDataProvider` abstraction

Every data source implements `functions/src/providers/FinancialDataProvider.ts`. Two adapters are live and
keyless:

- **Yahoo Finance** (`YahooFinanceProvider`) — unofficial `query2.finance.yahoo.com` endpoints. Used for quotes
  and company profile.
- **SEC EDGAR** (`SecEdgarProvider`) — official, keyless XBRL company-facts API. Used as the statement
  ground-truth source (`STATEMENT_PROVIDER` in `providers/index.ts`).

Four more are stubbed with the exact interface implemented and a documented TODO (`functions/src/providers/stubs.ts`):

| Provider | Env var | Docs |
|---|---|---|
| Financial Modeling Prep | `FMP_API_KEY` | https://site.financialmodelingprep.com/developer/docs |
| Alpha Vantage | `ALPHA_VANTAGE_API_KEY` | https://www.alphavantage.co/documentation/ |
| Finnhub | `FINNHUB_API_KEY` | https://finnhub.io/docs/api |
| Polygon | `POLYGON_API_KEY` | https://polygon.io/docs |

Swapping which provider backs ingestion is a one-line change in `providers/index.ts` — ingestion/metric code never
references a concrete provider class.

## Metrics & ranking engine

- ~70 metrics across 9 categories (`functions/src/metrics/calculators/`), registered in
  `functions/src/metrics/definitions.ts`. Adding a metric = one calculator function + one registry entry; nothing
  else in the pipeline changes.
- Ranking engine (`functions/src/ranking/rankingEngine.ts`): winsorization, percentile **or** z-score
  normalization (user-selectable), ascending/descending metric direction, year-weighted multi-year scoring
  (35/25/20/10/10 across up to 5 fiscal years, renormalized over whichever years are actually present), missing
  data excluded from weighting (never treated as zero), configurable category weights with the specified
  defaults (Valuation 30 / Profitability 20 / Growth 20 / Financial Strength 15 / Capital Allocation 10 /
  Earnings Quality 5).
- The "years of data" slider on the Home and Company pages calls `recomputeRankingsWithConfig` live and updates
  the page without a full reload.

## Known limitations / backlog

- **Historical valuation multiples use today's market cap for every fiscal year** — ingestion only pulls the
  current quote, not period-end historical prices, so P/E-style ratios for older fiscal years are approximate.
  Non-market metrics (profitability, growth, financial strength, efficiency, earnings quality, moat) are
  period-accurate. Fixing this needs a historical-price ingestion job keyed by statement period-end date.
- **Per-metric percentile/rank isn't persisted per historical year** — the Company page shows raw values per
  year (with missing-data messaging) plus category-level scores; a future pass could persist `MetricScore.percentile`/
  `.rankAmongPeers` per year for a richer breakdown table.
- **Seed universe is ~60 curated tickers**, not the full mid/large-cap universe — `sp500MembershipRefresh` expands
  coverage via a keyless Wikipedia scrape of the S&P 500 constituent table (fragile by nature; wrapped so a parse
  failure never breaks the rest of the daily refresh). Mid-cap (non-S&P 500) coverage beyond the seed list needs a
  broader universe source (e.g. once a paid provider like Polygon or FMP is wired up).
- **FMP / Alpha Vantage / Finnhub / Polygon** are stubs — see table above.
- Main frontend JS bundle is ~1.3MB gzip ~400KB (Firebase SDK + Recharts + TanStack). `xlsx` is already
  dynamically imported; further route-level code-splitting is a reasonable next step.

## Local development

```bash
npm install
npm run build:shared        # must run before build:functions or build:web pick up shared type changes
npm run dev:web              # Vite dev server
npm run emulators             # Firebase emulators (auth, firestore, functions, hosting)
npm test                      # Vitest unit tests (shared/functions/web)
npm run test:e2e              # Playwright e2e smoke tests
```

## Deployment

- **Hosting + Functions + Firestore rules/indexes:** `firebase deploy --project jj-analects-2-17`
- **CI/CD:** `.github/workflows/ci-cd.yml` — build+test+e2e on every push/PR; deploy job runs on push to `main`
  using a scoped service account (`github-actions-deploy@jj-analects-2-17.iam.gserviceaccount.com`, roles:
  `firebase.admin`, `iam.serviceAccountUser`, `run.admin`, `artifactregistry.writer`, `cloudscheduler.admin`,
  `pubsub.editor`, `cloudfunctions.admin`) via the `FIREBASE_SERVICE_ACCOUNT` GitHub secret.

### One-time setup still required

1. **Stripe secrets** — set the real values (placeholders are currently deployed so `firebase deploy --only
   functions` doesn't block on missing secrets):
   ```bash
   firebase functions:secrets:set STRIPE_SECRET_KEY --project jj-analects-2-17
   firebase functions:secrets:set STRIPE_WEBHOOK_SECRET --project jj-analects-2-17
   ```
   Run these in your own terminal (not via a shared/logged session) so the key material never appears in any
   transcript. `STRIPE_PRICE_ID` is already set to the live "Analects 2.17 Subscription" price
   (`price_1Tw59X8omxNVZA9Ey5iGF4zW`, $2/month).
2. **Stripe webhook endpoint** — in the Stripe Dashboard, add an endpoint pointing at the deployed `stripeWebhook`
   function URL (`firebase functions:list` after deploy to get it) listening for `checkout.session.completed`,
   `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`. Copy the
   resulting signing secret into `STRIPE_WEBHOOK_SECRET` per step 1.
3. **Seed data** — call the `bootstrapSeedUniverse` callable once (admin-only, gated to
   `jonathanmjong@gmail.com`) to populate the ~60-ticker seed universe and compute initial rankings before the
   nightly scheduled jobs take over.
4. **Branch protection** — recommend requiring the `build-and-test` check to pass before merging to `main`, since
   `main` auto-deploys to production.
