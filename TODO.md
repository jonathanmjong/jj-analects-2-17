# TODO

Running list of known open items. Not a full backlog — just things worth not forgetting.

## Open

- **The universe screen had permanently stopped (found and fixed 2026-08-16).**
  `system/universeExpansion` latched on `status: "complete"` at cursor 10432/10432 on
  2026-07-24 and `claimLock` refused every invocation after that, so no company could be
  added for three weeks while `cleanupUniverse` kept removing them — the universe could only
  shrink. It now recycles with a `cycleCount` like the other cursor jobs. Watch that
  `cycleCount` keeps advancing; if it ever stops, the universe is silently freezing again.
- **`grossProfit` / `totalDebt` / `costOfRevenue` tag coverage fixed (2026-08-16).** All three
  read a single XBRL tag. Production nulls went totalDebt 51%->22%, grossProfit 58%->40%,
  costOfRevenue 100%->42%. This mattered most for debt: `ingestPrices` treats missing debt as
  ZERO when computing enterprise value, so EV silently omitted debt for half the universe and
  flattered leveraged companies on every EV multiple. That `?? 0` is still there deliberately
  (a null EV drops the company out of three rankings entirely) — revisit if the residual grows.
- **Ticker->CIK remaps silently produce empty companies.** SEC repointed `XOM` to a holdco CIK
  with no filings; it had no company document at all. Fixed with an explicit `CIK_OVERRIDES`
  entry (not name-matching, which could attach one company's fundamentals to another) plus a
  warning when a bundle returns no income AND no balance statements. Any future
  reorganization will hit this — the warning is how you'll find out.
- **Normalized-earnings metrics wired into the registry (done 2026-08-18).** `cape_ratio` and
  `earnings_vs_normalized` now compute; `MetricInput` carries up to 12 annual
  `valuationHistory` observations, sliced to end at each period row's fiscal year so the
  engine's year weighting averages five different numbers rather than five copies of one
  (verified in production: AAPL 42.6/46.2/50.0 across FY2025/24/23). Coverage 60-62%, and
  every null is principled — 18 of 200 sampled are loss-making through the cycle, 27 have
  genuinely short history, 9 have entries but under 7 usable net-income years. Both excluded
  for Real Estate; `earnings_vs_normalized` suppressed in loss years.
- **Residual XBRL data gaps after the 2026-08-15 net-income fix.** Net income nulls went
  134/1344 (10%) → 40 (3%) by resolving `NetIncomeLoss` →
  `NetIncomeLossAvailableToCommonStockholdersBasic` → `ProfitLoss` per fiscal period. What is
  left, in order of size:
  - ~~WELL and AMT report nothing under any of the three tags~~ — **WRONG, and already
    fixed (checked 2026-08-19).** Both carry recent annual facts under
    `NetIncomeLossAvailableToCommonStockholdersBasic`, and production has had correct values
    since the per-period fallback shipped: WELL FY2025 $936,845,000, AMT FY2025
    $2,529,500,000. What is true is that both STOPPED tagging `NetIncomeLoss` mid-history —
    WELL's last annual is FY2011, AMT's FY2020 — which is precisely the dropoff pattern the
    fallback was built for, and the provenance log confirms it
    ("net income resolved from NetIncomeLoss + NetIncomeLossAvailableToCommonStockholdersBasic").
    No registrant-change theory needed.
  - **`operatingIncome`: derivation TESTED AND REJECTED on evidence (2026-08-17).** The
    previously-suggested route, `Revenues − CostsAndExpenses`, is wrong: for XOM it equals
    pretax income EXACTLY (delta 0 in FY2024 and FY2025), because `CostsAndExpenses` already
    nets interest expense. Adopting it would set `ebit` to pretax income universe-wide —
    understating EBIT, inflating EV/EBIT, and making interest coverage (EBIT/interest)
    circular. It is not even consistent across filers: for O the same subtraction lands
    ~$192M BELOW pretax. The textbook alternative, `EBIT = pretaxIncome + interestExpense`,
    is sound (XOM FY2025: 41,268 + 603 = 41,871) but recovers only **6 of 31** null-OI
    non-financial companies — 13 lack pretaxIncome, 12 lack interestExpense — and would leave
    `ebit` on two different bases across the universe. Not worth it; leaving null is honest.
    The gap is also smaller than it appears: 24% universe-wide but 76% of it is Financials,
    where no operating-income subtotal exists by construction and EV/EBIT is already
    sector-gated off. Excluding Financials and Real Estate it is 9%.
  - **D&A coverage is 78% universe-wide** (Real Estate 88%, Financials 58%). The FFO metrics
    only need the REIT figure, and banks genuinely report little D&A, so this is mostly
    fine — but a filer using a tag outside
    `DepreciationDepletionAndAmortization`/`DepreciationAndAmortization` silently yields no FFO.
  - **Recommended but not done:** store a `netIncomeSourceTag` on `IncomeStatement` so the UI
    can flag NCI-inclusive figures and an audit can find them without re-fetching EDGAR.
- **`npm run lint` fixed (2026-08-16)** — oxlint is now a single root devDependency linting
  web, functions and shared in one pass, and CI runs it. Deliberately NOT a functions
  devDependency: Cloud Build installs `functions/` in isolation against its own standalone
  lockfile, so putting a linter there both broke the deploy and would have shipped dev tooling
  into the production install.

- **Price history is not merely stale — it is absent for ~99.5% of the universe (measured
  2026-08-22).** Of 200 companies sampled, **199 have no priceHistory document at all**; the one
  that does is 22 days old. The 4-hourly job has been 429ing on every ticker for months, so it
  has essentially never succeeded. Consequences, all now understood rather than assumed:
  the company page's Price History chart is empty for nearly every company (its empty state now
  says why, instead of "not available yet"); `latest.momentum` is null universe-wide, which is
  harmless because momentum defaults to 0% category weight AND the coverage denominator only
  counts weighted categories, so it neither moves scores nor drags coverage down. `marketData`
  is NOT a substitute: it holds ~24 points across 17 months for AAPL, not a daily series,
  because it only records the days a live quote actually succeeded.
- **Daily price history: abandoned as a paid/infra problem, routed around for free (2026-08-14).**
  Retried the VPC connector: the 2026-08-05 `ZONE_RESOURCE_POOL_EXHAUSTED` capacity problem is
  GONE, but both attempts failed with "connector failed to get healthy" — root cause found:
  the `default` subnet has Private Google Access OFF and there is no Cloud NAT, so connector
  VMs have no path to report healthy. Fixable only by creating a connector subnet + Cloud
  Router + NAT ≈ **$45–50/mo** (connector ~$10, NAT ~$32, static IP ~$5), which is ~25
  subscribers of revenue for one feed — rejected on cost. All of it (static IP, errored
  connector, the two firewall rules added) was torn down; verified zero remaining cost.
  Free alternatives surveyed and all dead ends: Stooq now gates on a JS proof-of-work
  challenge (returns HTTP 200 with challenge HTML — a naive status check would false-positive);
  Finnhub moved US candles to paid; Alpha Vantage free is 25 req/day. Yahoo now 429s from a
  residential IP too, so this was never purely a cloud-IP problem. Polygon's free tier
  (5 req/min, 2y history) remains the only viable keyed option if daily bars are ever needed.
  **What replaced it:** own-history valuation (Phase 3's actual goal) is served instead by
  EDGAR's `dei/EntityPublicFloat` companyconcept endpoint — ~17 annual market-value
  observations per company, free and keyless, from the API already in use. See
  FEATURE-RESEARCH.md F3. Caveat carried into the feature: public float excludes insider
  holdings and is dated at the fiscal-Q2 cover-page date, so it is a *self-comparison* basis
  only.
- **Price history ingestion still 100% blocked as of 2026-08-10 — decided to leave it for
  now.** The free mitigation (batch 150→40, schedule hourly→every 4h, deployed 2026-08-04)
  did NOT fix it — still HTTP 429 on every ticker. Tried a static outbound IP (Cloud NAT +
  reserved IP) on 2026-08-05: the IP and NAT gateway provisioned fine, but the Serverless VPC
  Access connector needed to route Cloud Functions through them failed 3x on
  `ZONE_RESOURCE_POOL_EXHAUSTED` (Google Cloud capacity shortage in us-central1, not a config
  issue — confirmed via `firebase-functions` v2 has no Direct VPC Egress option, only the
  connector path). Torn back down (IP/NAT/router all deleted, no ongoing cost) rather than
  leave partial infra running. If revisited: retry the connector creation (capacity may have
  freed up — same commands, see git history around 2026-08-05), or switch to a paid provider
  (Polygon/Finnhub/Alpha Vantage — stubbed in `functions/src/providers/stubs.ts`) instead.
  Existing companies' price history/momentum just stays stale, doesn't corrupt.
- **`valueanalects.com` domain migration** — blocked on the domain being registered
  (external registrar, requires payment) and DNS records added. No agent action possible
  until that's done manually.

## Done (kept for context, remove once stale)

- `functions/package-lock.json` generated (2026-08-05) — previously Cloud Build resolved
  caret-range deps fresh on every deploy (non-reproducible); this pins exact versions for
  functions/'s isolated deploy-time install. Generated standalone (outside the npm-workspaces
  root context, matching how Cloud Build actually installs it) — regenerate the same way if
  functions/package.json's dependencies change, not with a plain `npm install` from the repo
  root (that resolves against the root workspace lockfile instead and won't touch this file).
- Re-seed `metricDefinitions` in Firestore (Admin page → "Seed metric definitions") so the new
  Value Metrics panel shows `negativeIsBad` tags — pending a manual click, not agent-blocked.
