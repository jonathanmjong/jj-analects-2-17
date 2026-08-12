# Feature Research — What to Build Next (2026-08-11)

Method: three parallel research agents surveyed 13 commonly used stock-analysis tools
(Finviz, Zacks, Morningstar, stockanalysis.com · Simply Wall St, GuruFocus, TIKR, Koyfin ·
Stockopedia, Validea, Old School Value, Seeking Alpha, Yahoo Finance), a fourth inventoried
this repo, and a **blind panel of three independent judges** — shown only neutral feature
descriptions, no sources or rationale — scored each candidate on whether it helps evaluate
(a) undervaluation and (b) prospective price/value growth. Verdicts are in §4.

## 1. Strategic picture

- **Every feature competitors gate behind analyst-estimate feeds is structurally off the
  table** (forward P/E, PEG-forward, estimate revisions, price targets, Zacks Rank, Simply
  Wall St's Future Growth axis). Don't approximate them badly — decline them explicitly.
- **Everything that depends on long fundamental history + point-in-time discipline is wide
  open**, because EDGAR gives it away free and none of the four mainstream sites fully
  exploits it. Reverse-DCF, buyback-timing tests, own-history valuation percentiles live here.
- **Every serious competitor pairs a relative score with an absolute valuation.** Analects
  has only the relative half. The fair-value cluster (§3.1–3.3) closes the biggest
  philosophical gap in the product.
- At $2/mo against free Yahoo, the differentiator is *judgment*, not data volume: named
  strategies, grades, archetype labels, red flags — not a 73rd metric.
- **Unused assets already in Firestore**: `marketData/{date}` daily price/mcap/EV series
  (written every 5 min, read by nothing), `historicalRankings` daily score/rank snapshots
  (fetched, never rendered), full balance sheets (fetched, never rendered), ~1yr daily
  closes per company. Several features below are UI over data that already exists.

**Data constraints to respect** (from the repo inventory):
- Price history beyond ~1 year is blocked (Yahoo 429s); `marketData` accumulates go-forward.
  Features needing 10y prices are **gated** until the connector retry or a paid provider.
- Annual statements only (5 fiscal years, no quarters/TTM); `costOfRevenue`, `ebitda`,
  `eps`, `shortTermDebt`, `filedAt` are hardcoded null from ingestion (derive, don't assume).
- `totalDebt` is long-term only; `periodEnd` fabricated as Dec-31.

## 2. Candidate features (deduplicated across all research)

Each entry: what it does · who does it · fit · feasibility. Ordered by research-phase
priority; §4 has the blind-panel verdicts and §5 the final sequencing.

### F1. Reverse DCF — market-implied growth rate
Back-solve the DCF: given price, trailing FCF/owner earnings, net debt, shares, and a fixed
discount rate, compute the growth the market is pricing in; display beside realized 5y/10y
growth ("market implies 14%/yr; delivered 6%/yr for a decade"). *Who:* TIKR, GuruFocus,
Old School Value — but nobody screener-wide. *Fit:* purest margin-of-safety expression;
turns the absence of analyst estimates into a virtue; falsifiable, not oracular. *Feasibility:*
pure `shared/` solver (bisection) over existing EDGAR data + last close; runs client-side.
**Effort: low.**

### F2. Multi-model fair-value range with margin of safety
4–6 independent intrinsic values per company — Graham Number, Earnings Power Value, Peter
Lynch Fair Value, trailing-growth DCF (earnings- and FCF-based, GuruFocus-style: trailing-10y
growth, fixed ~12% discount), median-multiple reversion — shown as a *range* against price
with a headline "trading X% below/above." **Suppress any model whose preconditions fail**
(erratic FCF ⇒ no DCF) rather than print garbage. *Who:* GuruFocus Valuation Chart Box,
Old School Value fair-value range, Simply Wall St gauge. *Fit:* margin of safety is the
founding concept; model dispersion is itself signal. *Feasibility:* all EDGAR + current
price; maintenance capex proxied by D&A, disclosed inline. EPS derived from netIncome/shares.
**Effort: low-medium.**

### F3. Valuation vs own history — percentile + bands
For P/E, EV/EBIT, P/FCF, P/B: where today's multiple sits in the company's own multi-year
distribution ("EV/EBIT 11.2 — 18th percentile of its last decade"), plus a Mean/High/Low
band chart, and dual-cohort display beside the existing sector percentile ("cheap company
vs cheap moment"). *Who:* Morningstar, TIKR, Koyfin, GuruFocus GF-Value line, stockanalysis.
*Fit:* mean reversion is the mechanical core of value; distinguishes bargain from
structurally-cheap-sector value trap. *Feasibility:* **gated on multi-year price history**
(monthly/quarterly closes suffice; ~156k points, trivial storage). `marketData` covers
go-forward; backfill blocked until the 429 problem is solved. **Effort: medium, dominated
by the backfill.**

### F4. Business predictability rating (consistency stars)
1–5 stars for how tightly revenue/share and EBITDA-or-FCF/share track their own multi-year
trendline (R² / CV around log-linear trend) — rewards low variance, not high growth. Doubles
as the **trust gate for F2** (suppress DCF on 1–2 star businesses) and a screener filter.
*Who:* GuruFocus Predictability Rank — the best-evidenced feature found (published decile
backtests). *Fit:* extrapolating unpredictable businesses is where value investing fails;
this names the risk. *Feasibility:* pure EDGAR, one calculator + registry entry; 5 annual
years now (weaker than GF's 10 — say so in UI). **Effort: low. Highest value-per-line.**

### F5. Sector-relative letter grades (A–F) per category
Map each of the 10 category percentiles (already computed) to A–F by sector-relative
quintile, shown as a compact color strip on company pages and sortable screener columns;
grade expands to the underlying metrics with sector median + percentile. *Who:* Seeking
Alpha Factor Grades (most-copied UI in the category), Zacks Style Scores. *Fit:* rejecting
1,290 of 1,300 names in seconds is what a 72-metric model needs; presentation, not new math.
*Feasibility:* pure display mapping in `shared/` + UI. **Effort: very low.**

### F6. Guru strategy scorecard + named preset screens
(a) Score each company against 10–15 classic rule chains — Graham Defensive, Magic Formula,
Acquirer's Multiple, O'Shaughnessy Value Composite, Piotroski high-B/M, Neff, Fisher P/S,
Mohanram G-Score, Net-Net — as ranked % pass with expandable pass/fail criterion tables and
published interpretation bands (Validea's >90% / 70–80%). (b) Ship the same strategies as
one-click named screens with visible, editable formulas. *Who:* Validea (core product),
Stockopedia GuruScreens, Zacks/GuruFocus preset screens. *Fit:* the value canon made
operational; each screen teaches while it filters. *Feasibility:* all EDGAR except
estimate-dependent variants (drop Lynch/Zweig); needs the formula filter's field set widened
from 8 fields to the full registry (worth doing regardless). **Effort: medium; preset
screens alone are days.**

### F7. Forensic red-flag panel (severity-tagged)
Altman Z, Beneish M, accruals-vs-cashflow divergence, receivables growing faster than
revenue, inventory build, sharp margin decline, rising share count — one severity-tagged
panel (severe/medium) atop the company page, screenable by warning count; pairs with the
existing Piotroski F. *Who:* GuruFocus Warning Signs (32 measures), Old School Value safety
checklist, Stockopedia forensic block. *Fit:* value screens systematically surface companies
that are cheap for a reason; exclusion was half of Graham's method. *Feasibility:* Altman Z
trivial; **Beneish M compromised by null `costOfRevenue`/SG&A line items** — ship the
computable subset (DSRI, SGI, LVGI, TATA + margin trend from grossProfit) and label it a
partial M-Score. **Effort: low-medium.**

### F8. Capital allocation grade (Exemplary / Standard / Poor)
Rules-based grade on three pillars: balance-sheet health (net debt/EBITDA trend, coverage),
investment efficacy (ROIC vs assumed WACC, incremental ROIC on retained capital), and
distributions (buyback yield net of dilution, dividend FCF coverage, **and whether buybacks
happened at low or high own-history valuation** — the timing test nobody else computes).
*Who:* Morningstar (analyst-judged); stockanalysis.com surfaces inputs uncombined. *Fit:*
core Buffett/Thorndike territory; makes the existing capitalAllocation category a headline
verdict. *Feasibility:* all EDGAR; buyback-timing pillar **gated on F3's price history**
(ship 2 pillars first). **Effort: medium.**

### F9. Growth vs ROIC — value-creating growth
Chart + derived score answering "does growth create or destroy value": revenue/NOPAT growth
against ROIC minus assumed cost of capital, plus incremental ROIC (ΔNOPAT/Δinvested capital)
over 3/5y. *Who:* Old School Value explicitly; implicit in Buffett/Greenblatt doctrine.
*Fit:* the honest, estimate-free way to address growth prospects — demonstrated
reinvestment quality instead of forecasts. *Feasibility:* all EDGAR; invested-capital
definition needs care (goodwill, NOLs). **Effort: medium.**

### F10. Style archetype badges
Name each company's Quality × Value × Momentum tercile position: Quality Compounder,
Contrarian, Turnaround, **Value Trap** (cheap + deteriorating), Momentum Trap, etc. — badge
in tables, detail pages, screener filter. (Reword away from Stockopedia's trademarked set.)
*Who:* Stockopedia StockRanks styles. *Fit:* the Value Trap label converts existing scores
into the warning that matters most to value investors. *Feasibility:* lookup on ranks
already computed. **Effort: very low.**

### F11. Transparent pass/fail check system
Under the existing category radar, render each category score as enumerable binary checks —
green tick / red cross, actual value, threshold, one-line why (Simply Wall St's open-sourced
model supplies battle-tested thresholds for Value/Past-Performance/Health/Dividend axes).
*Who:* Simply Wall St Snowflake+checks, GuruFocus signs. *Fit:* checklists are the canonical
value discipline; converts an opaque composite into arguable facts. *Feasibility:* all data
present; editorial work defining thresholds. **Effort: low-medium.**

### F12. Score & rank history chart
Render the `historicalRankings` daily snapshots (already written, never displayed) as a
score/rank-over-time chart on the company page + sparkline column in rankings. Unique to
Analects — no competitor shows *their own model's* view of a company over time. *Fit:*
"is this getting cheaper or just staying cheap" over the model's history; also honest
track-record display. *Feasibility:* data exists today; `MiniSparkline.tsx` is dead code
waiting for exactly this. **Effort: very low.**

### F13. 3-input scenario mini-valuator
Inline model with exactly three sliders — revenue growth, operating margin, exit multiple —
pre-filled from the company's own trailing medians (not consensus), outputting implied price
and annualized return, Bull/Base/Bear side by side. *Who:* TIKR Valuation Model Builder,
Simply Wall St mini-valuator. *Fit:* "form your own estimate" is the value ethos; extends
the app's user-tunes-the-model philosophy from weights to valuation. *Feasibility:* math
shared with F1/F2; mostly frontend. **Effort: medium.**

### F14. Financial statement tables + click-to-chart
Full income/balance/cashflow tables (5 fiscal years, the balance sheet is already fetched
and dropped on the floor), where clicking any line item charts it — TIKR's signature
interaction. *Fit:* table stakes vs free competitors; prerequisite trust surface for
everything else ("show me the numbers behind the score"). *Feasibility:* pure frontend over
existing data. **Effort: low-medium.**

### Deliberately declined
- **Anything analyst-estimate-driven** (forward multiples, revisions grades, price targets) — no data source, and approximating badly is worse than declining.
- **13F guru tracking / Form 4 insider feeds** — EDGAR-derivable but CUSIP→ticker mapping has no free authoritative source; heavy lift, park it.
- **Dashboards (Koyfin-style)** — highest effort, lowest differentiation for a focused ranking app.
- **News/transcripts/real-time** — paid feeds, off-philosophy.

## 3. Cross-cutting enablers

- **E1. Multi-year price backfill** (gates F3, F8's timing pillar, Morningstar-style price-vs-fair-value history): weekly/monthly closes suffice. Blocked on the Yahoo 429 problem — retry the VPC connector or pay for Polygon/Finnhub (TODO.md).
- **E2. Widen the formula filter** from 8 hardcoded fields to the full metric registry (needed by F6, improves the screener regardless).
- **E3. Metric-history storage**: percentile-vs-own-history needs per-metric time series; `metricScores/{year}` already stores 5 annual snapshots — F3's fundamentals half is nearly free.

## 4. Blind verification panel — verdicts

Three independent judges (a Graham/Buffett-tradition practitioner, a factor-literature
quant, an adversarial consumer-protection skeptic) each scored the 14 candidates 1–5 on
"helps judge undervaluation" (V) and "helps judge prospective price/value growth" (G),
seeing only neutral descriptions — no sources, no feasibility notes, no rationale.

| # | Feature | V avg | G avg | Practitioner | Quant | Skeptic | Consensus |
|---|---------|:-----:|:-----:|:---:|:---:|:---:|---|
| F1 | Reverse DCF | **4.3** | 3.0 | REC | REC | REC | **BUILD** — in all three top-5s |
| F3 | Own-history valuation percentile | **4.3** | 2.0 | REC | REC | REC | **BUILD** (gated on price history) |
| F7 | Forensic red-flag panel | **4.0** | **3.7** | REC | REC | REC | **BUILD** — quant: "highest concentration of replicated anomalies" |
| F8 | Capital allocation grade | 3.3 | **4.0** | REC | REC | REC | **BUILD, modified** — demote/replace the WACC pillar |
| F14 | Financial statement explorer | 3.3 | 2.3 | REC | REC | REC | **BUILD** — the audit layer every other feature depends on for trust |
| F6 | Strategy scorecard + presets | **4.3** | 2.3 | REC | REC | NEUT | **BUILD, trimmed** — ~6 strategies not 15; drop %-score framing |
| F13 | 3-input scenario tool | 3.7 | 3.3 | REC | NEUT | REC | **BUILD, with safeguards** — skeptic's #1 ("only feature that reduces conviction") |
| F4 | Consistency rating | 3.3 | 2.7 | REC | REC | NEUT | **BUILD the gate, drop the stars** — all three praised suppression as "the best epistemic idea on the list"; all three flagged the 1–5 star display |
| F9 | Growth vs ROIC | 2.7 | **4.0** | REC | NEUT | REC | **BUILD chart only, no numeric score** — incremental-ROIC denominators explode; guard or suppress |
| F2 | Multi-model fair-value range | 3.3 | 1.7 | REC | NEUT | REJ | **REWORK OR PARK** — see below |
| F11 | Transparent check system | 3.3 | 2.3 | REC | NEUT | NEUT | **PARTIAL** — keep value/threshold/why tables; drop the radar and pass-count framing |
| F5 | Sector-relative letter grades | 2.7 | 2.3 | NEUT | NEUT | NEUT | **DEPRIORITIZE** — "three visual skins of one score set" (with F10/F11); adds comprehension, zero signal |
| F10 | Style archetype badges | 1.7 | 2.0 | NEUT | NEUT | REJ | **CUT the labels** — keep at most a screener filter over visible thresholds |
| F12 | Model score history | 1.3 | 1.7 | REJ | REJ | REJ | **CUT** — unanimous |

**Why F12 died** (it looked like the cheapest win — data already exists): the score series is
non-stationary (user weights + registry changes silently re-level it), price flowing through
valuation metrics makes the sparkline "an inverted price chart wearing a fundamental
costume," and it teaches rank-chasing in a product built for patient holding. All three
judges converged on this independently.

**Why F2 was demoted** (the practitioner's #1, the skeptic's REJECT): the models share
inputs, so their agreement is correlated error rendered as consensus; hiding erratic models
narrows the range exactly where uncertainty is highest; the "% below fair value" headline is
the strongest anchoring surface in the product. Salvageable form: individual model outputs
shown side by side, all of them, suppressed ones as visible "not computable" gaps, no
aggregate range, no headline %. In that form it overlaps F1+F13 heavily — park it until
those two ship and revisit.

### Design requirements the panel converged on (binding for implementation)

1. **No point-estimate headlines.** No "% undervalued" anywhere; modeled outputs ship as
   ranges with sensitivity to the 2–3 dominant assumptions; ≤2 significant figures.
2. **Discount rate visible and editable** on the same screen as any output using it — one
   hidden global assumption currently drives F1/F2/F8/F9. Label defaults as conventions.
3. **No selective display.** Show all models or suppress the whole panel with the reason
   (F4's gate); never silently drop the erratic ones.
4. **Denominator guards.** Suppress reverse-DCF when trailing FCF ≤ 0; suppress incremental
   ROIC on near-zero/negative ΔIC; winsorize; never render what the accounting can't support.
5. **Sector applicability gating.** Distress/manipulation composites, ROIC, EV-based metrics
   suppressed-with-explanation for banks, insurers, REITs — not displayed wrong. (These are a
   large slice of a 1,300-name mid/large universe; the app currently scores them silently.)
6. **Neutral, descriptive naming.** "Accrual quality: elevated attention," never
   "manipulation risk"; conditions ("cheap + deteriorating fundamentals"), never verdict
   labels ("value trap").
7. **Base rates beside flags.** "X% of the universe also trips this" on every forensic flag
   to prevent alarm fatigue and false certainty.
8. **Anchoring mitigation on F13.** Pre-fills labeled "the past, not a forecast"; show each
   slider's historical dispersion; show which slider dominates the output.
9. **Strategy screens:** publication date + tested-universe disclosure inline; show
   universe-wide hit-counts (a strict Graham chain that passes ~0 mid/large caps is a dead
   row — drop it); Magic Formula's edge is mostly the earnings-yield leg — say so.
10. **Language rule product-wide:** "priced as if FCF grows X%/yr for Y years," never
    "undervalued by 40%."

### Gaps the panel raised that the research missed (candidate future work)

- **Normalized / cyclically-adjusted earnings** (7–10y average EPS, mid-cycle margins) — the
  practitioner's #1 gap; everything in the list is trailing-point-estimate-heavy.
- **Sector-appropriate frameworks for financials/insurers/REITs** (P/TBV, FFO/AFFO) or
  explicit exclusion — both fundamental judges flagged this as more important than any
  single feature.
- **Gross profitability (GP/assets), asset-growth factor, net share issuance as ranked
  factors, net operating assets** — quant: best-documented signals absent from the registry.
- **SBC/dilution honesty**: per-share growth everywhere; SBC as % of revenue/FCF.
- **Point-in-time discipline + delisted-name retention** if any historical claim is ever
  shown; **per-company data-quality indicator** (which metrics are null/stale — silent nulls
  currently distort composite ranks invisibly).

## 5. Recommended sequencing

**Phase 1 — no new data, low effort, unanimous verdicts:**
1. **F1 Reverse DCF** (with guards 2/4/5, sensitivity band across 3 discount rates)
2. **F7 Forensic panel** (computable subset; neutral naming; base rates; sector gating)
3. **F4 as a gate** (consistency computation suppresses F1 output on erratic businesses; no
   star display)
4. **F14 Statement explorer** (income + the already-fetched-but-unrendered balance sheet +
   cash flow; click-line-to-chart)

**Phase 2 — medium effort, still no new data:**
5. **F6 trimmed**: ~6 strategies (Magic Formula, Acquirer's Multiple, O'Shaughnessy VC,
   Piotroski high-B/M, Net-Net as a curiosity, Owner-Earnings Yield) + named preset screens;
   requires **E2** (widen formula-filter fields to full registry — do first)
6. **F8 capital allocation**, pillars 1+3a now (balance-sheet trend, distributions net of
   dilution); replace ROIC−WACC pillar with GP/assets level + trend per the quant
7. **F9 chart** (no score), **F13 scenario tool** (with safeguard 8)

**Phase 3 — gated on E1 (multi-year price backfill: VPC retry or paid provider):**
8. **F3 own-history percentiles + bands** (quarterly closes suffice; median/quartile not
   mean±σ; regime/M&A discontinuity flags)
9. **F8 pillar 3b** (buyback timing vs own-history valuation — as descriptive fact, not grade)

**Cut:** F12 entirely; F10 labels; F5 as a standalone feature; F2 as originally specced.
