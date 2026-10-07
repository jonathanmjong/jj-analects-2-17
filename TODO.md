# TODO

Running list of known open items. Not a full backlog — just things worth not forgetting.

## Open

- **Watch `system/universeExpansion.cycleCount` keeps advancing.** The universe screen
  permanently latched on `status: "complete"` for three weeks (2026-07-24 to 2026-08-16) while
  `cleanupUniverse` kept removing companies, so the universe could only shrink — full story in
  the CI history around 2026-08-16. It now recycles weekly and has run cleanly since (verified
  2026-09-10: `cycleCount: 8`, 1,349 companies, correctly idle between passes). If `cycleCount`
  ever stops advancing for more than ~2 weeks, it's silently freezing again.
- **Ticker→CIK remaps silently produce empty companies.** SEC repointed `XOM` to a holdco CIK
  with no filings; it had no company document at all. Fixed with an explicit `CIK_OVERRIDES`
  entry (not name-matching, which could attach one company's fundamentals to another) plus a
  warning when a bundle returns no income AND no balance statements. Any future
  reorganization will hit this — the warning is how you'll find out.
- **Enterprise value's `?? 0` debt fallback is a deliberate, revisit-able choice.** Missing
  `totalDebt` is treated as zero when computing EV (a null EV would drop the company out of
  EV/EBIT, EV/EBITDA and EV/FCF entirely, which is worse for a screener). `totalDebt` null rate
  was 51% before the multi-tag fallback landed, now holds around 21% (checked 2026-09-10).
  Revisit the `?? 0` if that residual starts climbing again instead of holding steady.
- **Residual XBRL data gaps**, in order of size:
  - **`operatingIncome`: derivation tested and rejected on evidence (2026-08-17) — don't
    re-attempt the obvious fix.** `Revenues − CostsAndExpenses` looks like it should work but
    isn't EBIT: for XOM it equals pretax income exactly (delta 0 across two fiscal years),
    because `CostsAndExpenses` already nets interest expense. Using it would set `ebit` to
    pretax income universe-wide — understating EBIT, inflating EV/EBIT, and making interest
    coverage circular — and it isn't even consistent across filers (for O the same subtraction
    lands ~$192M *below* pretax). The textbook fallback, `pretaxIncome + interestExpense`, is
    sound but only recovers 6 of 31 null-OI non-financial companies and would leave `ebit` on
    two different bases across the universe. Left null deliberately. The gap is smaller than it
    looks: 24% universe-wide but 76% of that is Financials, where no operating-income subtotal
    exists by construction and EV/EBIT is already sector-gated off there anyway — 9% excluding
    Financials and Real Estate.
  - **D&A coverage is ~78% universe-wide** (Real Estate ~88%, Financials ~58%, expected — banks
    genuinely report little D&A). The FFO metrics only need the REIT figure, so this is mostly
    fine, but a filer using a tag outside `DepreciationDepletionAndAmortization` /
    `DepreciationAndAmortization` silently yields no FFO for that company.
  - `netIncomeSourceTag` now ships on `IncomeStatement` (see Done below), so an NCI-inclusive
    figure is identifiable per year without re-fetching EDGAR.
- **Price history is absent for ~99% of the universe, and free options are exhausted.**
  Measured 2026-08-22: of 200 companies sampled, 199 had no `priceHistory` document at all (the
  4-hourly ingestion job has been 429ing on every ticker for months, essentially never
  succeeding). `marketData` is NOT a substitute — it holds sparse live-quote snapshots (~24
  points across 17 months for AAPL), not a daily series, since it only records days a quote
  actually got through. Consequences, all understood rather than assumed: the company page's
  price chart is empty for nearly every company (its empty state says why, not "not available
  yet"); `latest.momentum` is null universe-wide, which is harmless because momentum sits at 0%
  category weight and the coverage denominator only counts weighted categories, so it neither
  moves scores nor drags coverage down.
  Every free path has been tried and closed off: batch/schedule throttling (2026-08-04) didn't
  help: still 429 on every ticker. A static outbound IP via Cloud NAT (2026-08-05) hit
  `ZONE_RESOURCE_POOL_EXHAUSTED` on the Serverless VPC Access connector three times (GCP capacity
  in us-central1, not a config issue — `firebase-functions` v2 has no Direct VPC Egress, only the
  connector path); torn back down, zero ongoing cost. Retried the connector alone (2026-08-14)
  once that specific capacity error was gone — still failed, root cause this time: the `default`
  subnet has Private Google Access off and no Cloud NAT, so connector VMs have no path to report
  healthy. Fixing that needs a connector subnet + Cloud Router + NAT ≈ **$45–50/mo**, about 25
  subscribers of revenue for one data feed — rejected on cost, everything torn down again.
  Free API alternatives all dead-ended too: Stooq now gates on a JS proof-of-work challenge
  (returns HTTP 200 with challenge HTML — a naive status check would false-positive as success);
  Finnhub moved US candles to paid; Alpha Vantage free tier is 25 requests/day. Yahoo 429s from a
  residential IP too, so this was never purely a cloud-IP problem. Polygon's free tier (5
  req/min, 2 years of history) remains the only viable *keyed* option if daily bars are ever
  worth paying for.
  **What actually shipped instead:** the real goal (own-history valuation, not daily bars) is
  served by EDGAR's `dei/EntityPublicFloat` companyconcept endpoint — ~10-17 annual market-value
  observations per company, free, keyless, from an API already in use. See FEATURE-RESEARCH.md
  F3. Caveat carried into that feature: public float excludes insider holdings and is dated at
  the fiscal-Q2 cover-page date, so it's a *self-comparison* basis only, never mixed with
  market-cap-based multiples.
- **`valueanalects.com` domain migration** — blocked on the domain being registered
  (external registrar, requires payment) and DNS records added. No agent action possible
  until that's done manually.

## Done (kept for context, remove once stale)

- **Net income basis is now recorded per year, not just logged (2026-10-07).**
  `IncomeStatement.netIncomeSourceTag` carries which of `NET_INCOME_TAGS` supplied that fiscal
  year's figure, resolved by the same per-period precedence the value itself goes through — so a
  filer whose history straddles two bases (the EXC/VTR dropoff shape) shows the real tag on each
  year rather than one company-level label. The statements table flags only `ProfitLoss`-sourced
  cells, the one basis that includes noncontrolling interests;
  `NetIncomeLossAvailableToCommonStockholdersBasic` is a different but not misleading basis
  (market cap prices common equity) and is deliberately unflagged. Optional on the type because
  pre-existing Firestore documents lack the key until the nightly ingestion rewrites them —
  `set(stmt, { merge: true })` backfills it with no migration.
- **Ingestion tag-coverage fixes (2026-08-16 through 2026-08-19), holding steady 3+ weeks later
  (checked 2026-09-10, 196 sampled):** netIncome null 3%→**1%**, totalDebt null 51%→**21%**,
  grossProfit null 58%→**36%**, costOfRevenue null (was hardcoded null for everyone)→**38%**,
  shareBasedComp null→**6%**. All via strict per-period tag precedence
  (`annualSeriesWithFallback`), never a plain multi-tag merge — a merge breaks per-period ties on
  `filed`, which is identical across tags within one filing, so it would silently pick whichever
  tag happened to iterate first and could swap accounting bases on companies that were already
  correct. See `functions/src/providers/SecEdgarProvider.ts`.
- **Normalized-earnings metrics wired into the registry (2026-08-18), holding/improving 3+ weeks
  later (checked 2026-09-10):** `cape_ratio` coverage 61%→**68%**, `earnings_vs_normalized`
  58%→**65%**. `MetricInput` carries up to 12 annual `valuationHistory` observations, sliced to
  end at each period row's fiscal year so the engine's year weighting averages five different
  numbers rather than five copies of one (verified in production: AAPL 42.6/46.2/50.0 across
  FY2025/24/23). Both excluded for Real Estate; `earnings_vs_normalized` suppressed in loss years.
- `functions/package-lock.json` generated (2026-08-05) — previously Cloud Build resolved
  caret-range deps fresh on every deploy (non-reproducible); this pins exact versions for
  functions/'s isolated deploy-time install. Generated standalone (outside the npm-workspaces
  root context, matching how Cloud Build actually installs it) — regenerate the same way if
  functions/package.json's dependencies change, not with a plain `npm install` from the repo
  root (that resolves against the root workspace lockfile instead and won't touch this file).
- Re-seed `metricDefinitions` in Firestore (Admin page → "Seed metric definitions") so the new
  Value Metrics panel shows `negativeIsBad` tags — pending a manual click, not agent-blocked.
