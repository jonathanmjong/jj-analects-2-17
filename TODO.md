# TODO

Running list of known open items. Not a full backlog — just things worth not forgetting.

## Open

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
