# TODO

Running list of known open items. Not a full backlog — just things worth not forgetting.

## Open

- **Price history ingestion degraded.** Yahoo's `/v8/finance/chart` endpoint has been
  returning HTTP 429 on ~100% of requests since at least 2026-07-29 (see
  `functions/src/ingestion/ingestPriceHistory.ts`). Mitigated 2026-08-04 by cutting request
  volume (batch 150→40, schedule hourly→every 4h) — not confirmed to have fixed it yet. Check
  `dataRefreshLogs` (`dataType: "price_history"`) for a `success`/`partial_failure` entry; if
  it's still 100% `failure` after a few days, the free mitigation didn't work and the real
  options are a paid data provider (Polygon/Finnhub/Alpha Vantage — stubbed in
  `functions/src/providers/stubs.ts`) or a static outbound IP (Cloud NAT).
- **`valueanalects.com` domain migration** — blocked on the domain being registered
  (external registrar, requires payment) and DNS records added. No agent action possible
  until that's done manually.
- **`functions/package-lock.json` doesn't exist.** Cloud Build resolves caret-range deps
  fresh on every deploy — non-reproducible. Low-risk today, but a future upstream dependency
  change could silently reintroduce a packaging bug (this already happened once with the
  `firebase-functions/v2` logger barrel import).

## Done (kept for context, remove once stale)

- Re-seed `metricDefinitions` in Firestore (Admin page → "Seed metric definitions") so the new
  Value Metrics panel shows `negativeIsBad` tags — pending a manual click, not agent-blocked.
