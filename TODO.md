# TODO

Running list of known open items. Not a full backlog — just things worth not forgetting.

## Open

- **Price history ingestion still 100% blocked as of 2026-08-05.** The free mitigation
  (batch 150→40, schedule hourly→every 4h, deployed 2026-08-04) did NOT fix it — 8+
  consecutive runs at the reduced volume all still returned HTTP 429 on every ticker, and a
  live spot-check on 2026-08-05 confirmed it's still failing. This needs the bigger decision
  already raised to the user once: a paid data provider (Polygon/Finnhub/Alpha
  Vantage — stubbed in `functions/src/providers/stubs.ts`) or a static outbound IP (Cloud
  NAT). Existing companies' price history/momentum just stays stale, doesn't corrupt.
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
