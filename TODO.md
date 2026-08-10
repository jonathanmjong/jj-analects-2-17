# TODO

Running list of known open items. Not a full backlog — just things worth not forgetting.

## Open

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
