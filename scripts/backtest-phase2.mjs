/**
 * Phase 2 point-in-time backtest (pilot). Reconstructs what a cross-sectional
 * ranking would have scored each company at past quarterly "as-of" dates,
 * using only SEC EDGAR facts actually FILED by that date (not restated/
 * future data — avoids look-ahead bias) and the Yahoo daily price on/before
 * that date, then measures forward returns per score quantile.
 *
 * Deliberately NOT the full production metric set (~70 metrics): this is a
 * pilot covering ~7 point-in-time-reconstructable metrics across valuation/
 * profitability/growth/financial strength/cash generation, run through the
 * *same* shared/rankingEngineCore.js algorithm the live app uses, so the
 * scoring mechanics are real even though metric coverage is narrower.
 *
 * Universe: top-N by current market cap (survivorship bias — a v1
 * limitation, see CLAUDE.md/session notes: no point-in-time index
 * membership source wired up yet).
 *
 * Run: node scripts/backtest-phase2.mjs [universeSize]   (default 40)
 * No deps beyond Node's built-in fetch + a logged-in `gcloud` CLI (used to
 * pull the pilot universe — top-N by current market cap — straight from
 * Firestore); SEC/Yahoo are both free+keyless. Paces SEC requests
 * conservatively (SEC asks <=10 req/sec).
 */
import { execSync } from "node:child_process";
import { computeCrossSectionalRankings } from "../shared/dist/index.js";

const USER_AGENT = "Analects217 backtest research (contact: jonathanmjong@gmail.com)";
const PROJECT = "jj-analects-2-17";
const UNIVERSE_SIZE = Number(process.argv[2] ?? 40);

async function loadTopByMarketCap(n) {
  const token = execSync("gcloud auth print-access-token").toString().trim();
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:runQuery`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "companies" }],
        orderBy: [{ field: { fieldPath: "latest.marketCap" }, direction: "DESCENDING" }],
        limit: n,
      },
    }),
  });
  const json = await res.json();
  return json.filter((x) => x.document).map((x) => x.document.name.split("/").pop());
}

const TICKERS = await loadTopByMarketCap(UNIVERSE_SIZE);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ---- SEC EDGAR: ticker -> CIK, company facts ----

async function loadTickerCikMap() {
  const json = await fetchJson("https://www.sec.gov/files/company_tickers.json");
  const map = new Map();
  for (const entry of Object.values(json ?? {})) {
    map.set(entry.ticker.toUpperCase(), String(entry.cik_str).padStart(10, "0"));
  }
  return map;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A single 10-K's XBRL data includes the primary annual figure AND every
 * comparative period (prior years, and for duration tags, sub-year quarterly
 * breakdowns too) — all sharing the same `fy`/`filed`/`form`, distinguished
 * only by `start`/`end`. `fy` is therefore NOT a safe dedup key (confirmed:
 * grouping by fy silently picked an arbitrary comparative-quarter figure
 * instead of the actual annual one). Dedup by `end` date instead: for
 * duration facts (income/cash-flow — "for the fiscal year"), first restrict
 * to ~annual-length periods so quarterly comparatives are excluded; for
 * instant facts (balance-sheet — "as of a date", no meaningful duration),
 * every entry already corresponds to a distinct fiscal period end.
 */
function annualFactSeries(facts, tags, { instant = false } = {}) {
  // Merge across tags rather than "first tag with any data" — companies commonly switch which
  // exact XBRL tag they report a concept under mid-history (e.g. most filers moved from `Revenues`
  // to `RevenueFromContractWithCustomerExcludingAssessedTax` around ASC 606 adoption, ~2018).
  // Picking only the first non-empty tag silently truncates the series at that switchover.
  const merged = [];
  for (const tag of tags) {
    const units = facts?.facts?.["us-gaap"]?.[tag]?.units;
    const raw = units?.USD ?? units?.["USD/shares"] ?? units?.shares ?? [];
    let series = raw.filter((f) => f.form === "10-K").map((f) => ({ start: f.start, end: f.end, val: f.val, filed: f.filed }));
    if (!instant) {
      series = series.filter((f) => {
        if (!f.start) return false;
        const days = (new Date(f.end).getTime() - new Date(f.start).getTime()) / DAY_MS;
        return days >= 350 && days <= 380;
      });
    }
    merged.push(...series);
  }
  return merged;
}

/** Most recent annual figure actually filed on or before asOfDate (latest `end` among filed<=asOfDate). */
function valueAsOf(series, asOfDate) {
  const byEnd = new Map();
  for (const f of series) {
    if (f.filed > asOfDate) continue;
    const existing = byEnd.get(f.end);
    if (!existing || f.filed > existing.filed) byEnd.set(f.end, f);
  }
  if (byEnd.size === 0) return null;
  // Attach a synthetic fy (fiscal year of the period end) so downstream growth-comparison logic
  // (which filters "prior fiscal years") can compare periods without relying on SEC's own `fy` tag.
  return [...byEnd.values()].map((f) => ({ ...f, fy: new Date(f.end).getUTCFullYear() })).sort((a, b) => b.end.localeCompare(a.end))[0];
}

function buildFactSeriesBundle(facts) {
  return {
    revenue: annualFactSeries(facts, ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax"]),
    netIncome: annualFactSeries(facts, ["NetIncomeLoss"]),
    grossProfit: annualFactSeries(facts, ["GrossProfit"]),
    opIncome: annualFactSeries(facts, ["OperatingIncomeLoss"]),
    equity: annualFactSeries(facts, ["StockholdersEquity"], { instant: true }),
    longTermDebt: annualFactSeries(facts, ["LongTermDebtNoncurrent"], { instant: true }),
    cash: annualFactSeries(facts, ["CashAndCashEquivalentsAtCarryingValue"], { instant: true }),
    ocf: annualFactSeries(facts, ["NetCashProvidedByUsedInOperatingActivities"]),
    capex: annualFactSeries(facts, ["PaymentsToAcquirePropertyPlantAndEquipment"]),
    epsDiluted: annualFactSeries(facts, ["EarningsPerShareDiluted"]),
    dilutedShares: annualFactSeries(facts, ["WeightedAverageNumberOfDilutedSharesOutstanding"]),
  };
}

// ---- Yahoo: daily price series ----

async function fetchPriceSeries(ticker) {
  const json = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=10y`);
  const r = json?.chart?.result?.[0];
  const ts = r?.timestamp;
  const closes = r?.indicators?.quote?.[0]?.close;
  if (!ts || !closes) return null;
  const points = [];
  for (let i = 0; i < ts.length; i++) {
    if (closes[i] == null) continue;
    points.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), close: closes[i] });
  }
  return points.length > 0 ? points : null;
}

function priceOnOrBefore(points, date) {
  let best = null;
  for (const p of points) {
    if (p.date <= date && (!best || p.date > best.date)) best = p;
  }
  return best;
}
function priceOnOrAfter(points, date) {
  let best = null;
  for (const p of points) {
    if (p.date >= date && (!best || p.date < best.date)) best = p;
  }
  return best;
}

// ---- Point-in-time metric computation for one ticker at one as-of date ----

const METRICS = [
  { key: "pe", label: "P/E", category: "valuation", direction: "asc", unit: "multiple", description: "", enabled: true },
  { key: "evEbit", label: "EV/EBIT", category: "valuation", direction: "asc", unit: "multiple", description: "", enabled: true },
  { key: "fcfYield", label: "FCF Yield", category: "cashGeneration", direction: "desc", unit: "percent", description: "", enabled: true },
  { key: "roe", label: "ROE", category: "profitability", direction: "desc", unit: "percent", description: "", enabled: true },
  { key: "grossMargin", label: "Gross Margin", category: "profitability", direction: "desc", unit: "percent", description: "", enabled: true },
  { key: "revenueGrowth", label: "Revenue Growth", category: "growth", direction: "desc", unit: "percent", description: "", enabled: true },
  { key: "debtToEquity", label: "Debt/Equity", category: "financialStrength", direction: "asc", unit: "ratio", description: "", enabled: true },
];

function computeMetricsAsOf(bundle, priceSeries, asOfDate) {
  const price = priceOnOrBefore(priceSeries, asOfDate);
  if (!price) return null;

  const rev = valueAsOf(bundle.revenue, asOfDate);
  const ni = valueAsOf(bundle.netIncome, asOfDate);
  const gp = valueAsOf(bundle.grossProfit, asOfDate);
  const opInc = valueAsOf(bundle.opIncome, asOfDate);
  const eq = valueAsOf(bundle.equity, asOfDate);
  const debt = valueAsOf(bundle.longTermDebt, asOfDate);
  const cash = valueAsOf(bundle.cash, asOfDate);
  const ocf = valueAsOf(bundle.ocf, asOfDate);
  const capex = valueAsOf(bundle.capex, asOfDate);
  const eps = valueAsOf(bundle.epsDiluted, asOfDate);
  const shares = valueAsOf(bundle.dilutedShares, asOfDate);

  if (!shares) return null;
  const marketCap = price.close * shares.val;
  const ev = debt || cash ? marketCap + (debt?.val ?? 0) - (cash?.val ?? 0) : null;

  // Revenue growth needs the prior fiscal year too, from the same as-of vantage point.
  let revenueGrowth = null;
  if (rev) {
    const priorSeries = bundle.revenue.filter((f) => f.fy < rev.fy);
    const prior = valueAsOf(priorSeries, asOfDate);
    if (prior && prior.val > 0) revenueGrowth = rev.val / prior.val - 1;
  }

  return {
    date: price.date,
    values: {
      pe: eps && eps.val > 0 ? price.close / eps.val : null,
      evEbit: ev != null && opInc && opInc.val > 0 ? ev / opInc.val : null,
      fcfYield: ocf && capex && marketCap > 0 ? (ocf.val - Math.abs(capex.val)) / marketCap : null,
      roe: ni && eq && eq.val > 0 ? ni.val / eq.val : null,
      grossMargin: gp && rev && rev.val > 0 ? gp.val / rev.val : null,
      revenueGrowth,
      debtToEquity: debt && eq && eq.val > 0 ? debt.val / eq.val : null,
    },
  };
}

// ---- Main ----

console.log(`Pilot universe: ${TICKERS.length} tickers`);
console.log("Loading SEC ticker->CIK map...");
const cikMap = await loadTickerCikMap();

const bundles = new Map();
const priceSeriesByTicker = new Map();

for (const ticker of TICKERS) {
  const cik = cikMap.get(ticker.toUpperCase().replace(/-/g, ""));
  const [facts, prices] = await Promise.all([
    cik ? fetchJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`) : Promise.resolve(null),
    fetchPriceSeries(ticker),
  ]);
  if (facts) bundles.set(ticker, buildFactSeriesBundle(facts));
  if (prices) priceSeriesByTicker.set(ticker, prices);
  console.log(`  ${ticker}: cik=${cik ?? "none"} facts=${facts ? "ok" : "MISSING"} prices=${prices ? prices.length : "MISSING"}`);
  await sleep(250);
}

// Quarterly as-of dates over the past 5 years.
const asOfDates = [];
const start = new Date();
start.setFullYear(start.getFullYear() - 5);
for (let d = new Date(start); d < new Date(); d.setMonth(d.getMonth() + 3)) {
  asOfDates.push(new Date(d).toISOString().slice(0, 10));
}

console.log(`\nRunning ${asOfDates.length} historical as-of dates x ${TICKERS.length} tickers...`);

const config = {
  categoryWeights: { valuation: 0.25, profitability: 0.25, growth: 0.2, financialStrength: 0.15, cashGeneration: 0.15, momentum: 0, capitalAllocation: 0, efficiency: 0, earningsQuality: 0, moat: 0 },
  normalizationMethod: "percentile",
  winsorizeLowerPct: 0.01,
  winsorizeUpperPct: 0.99,
  yearsIncluded: 1,
};

const allBucketRows = []; // {asOfDate, ticker, score, forwardReturn6m, forwardReturn12m}

for (const asOfDate of asOfDates) {
  const universe = [];
  const priceAtDate = new Map();
  for (const ticker of TICKERS) {
    const bundle = bundles.get(ticker);
    const prices = priceSeriesByTicker.get(ticker);
    if (!bundle || !prices) continue;
    const snap = computeMetricsAsOf(bundle, prices, asOfDate);
    if (!snap) continue;
    universe.push({ ticker, byYear: [snap.values] });
    priceAtDate.set(ticker, prices);
  }
  if (universe.length < 10) continue;

  const { results } = computeCrossSectionalRankings(universe, METRICS, config);

  for (const r of results) {
    if (r.overallScore == null) continue;
    const prices = priceAtDate.get(r.ticker);
    const basePrice = priceOnOrBefore(prices, asOfDate);
    if (!basePrice) continue;

    const d6 = new Date(asOfDate);
    d6.setMonth(d6.getMonth() + 6);
    const d12 = new Date(asOfDate);
    d12.setFullYear(d12.getFullYear() + 1);

    const p6 = priceOnOrAfter(prices, d6.toISOString().slice(0, 10));
    const p12 = priceOnOrAfter(prices, d12.toISOString().slice(0, 10));

    allBucketRows.push({
      asOfDate,
      ticker: r.ticker,
      score: r.overallScore,
      forwardReturn6m: p6 ? (p6.close - basePrice.close) / basePrice.close : null,
      forwardReturn12m: p12 ? (p12.close - basePrice.close) / basePrice.close : null,
    });
  }
}

console.log(`\nTotal (date, ticker) observations with a score: ${allBucketRows.length}`);

function bucketReport(horizonKey, label) {
  const rows = allBucketRows.filter((r) => r[horizonKey] != null);
  console.log(`\n--- Forward ${label} return, bucketed by score quintile (pooled across all as-of dates) ---`);
  console.log(`N with valid forward return: ${rows.length}`);
  if (rows.length < 20) {
    console.log("Too few to bucket meaningfully.");
    return;
  }

  // Rank within each as-of date (cross-sectional quintile), then pool.
  const byDate = new Map();
  for (const r of rows) {
    if (!byDate.has(r.asOfDate)) byDate.set(r.asOfDate, []);
    byDate.get(r.asOfDate).push(r);
  }
  const withQuintile = [];
  for (const [, dateRows] of byDate) {
    dateRows.sort((a, b) => b.score - a.score);
    const bucketSize = Math.ceil(dateRows.length / 5);
    dateRows.forEach((r, idx) => withQuintile.push({ ...r, quintile: Math.min(4, Math.floor(idx / bucketSize)) }));
  }

  console.log("Quintile".padEnd(10), "N".padEnd(6), "AvgReturn".padEnd(12), "MedianReturn");
  for (let q = 0; q < 5; q++) {
    const chunk = withQuintile.filter((r) => r.quintile === q);
    if (chunk.length === 0) continue;
    const avg = chunk.reduce((a, r) => a + r[horizonKey], 0) / chunk.length;
    const sorted = chunk.map((r) => r[horizonKey]).sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    console.log(`${q + 1} (${q === 0 ? "best" : q === 4 ? "worst" : ""})`.padEnd(10), `${chunk.length}`.padEnd(6), `${(avg * 100).toFixed(2)}%`.padEnd(12), `${(med * 100).toFixed(2)}%`);
  }

  const n = withQuintile.length;
  const meanScore = withQuintile.reduce((a, r) => a + r.score, 0) / n;
  const meanRet = withQuintile.reduce((a, r) => a + r[horizonKey], 0) / n;
  let cov = 0, varScore = 0, varRet = 0;
  for (const r of withQuintile) {
    cov += (r.score - meanScore) * (r[horizonKey] - meanRet);
    varScore += (r.score - meanScore) ** 2;
    varRet += (r[horizonKey] - meanRet) ** 2;
  }
  const corr = cov / Math.sqrt(varScore * varRet);
  console.log(`Correlation(score, forward ${label} return): ${corr.toFixed(3)} (positive = higher score -> better return, as hoped)`);
}

bucketReport("forwardReturn6m", "6-month");
bucketReport("forwardReturn12m", "12-month");
