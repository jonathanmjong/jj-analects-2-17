/**
 * Phase 1 (free, no-new-infra) sanity check for "do top-ranked companies get
 * better forward returns": buckets companies by the earliest available
 * historicalRankings score and compares to price return since. Reads
 * directly via the Firestore REST API using your own gcloud credentials
 * (bypasses security rules, same as any Admin-level access) — no service
 * account key or npm deps beyond a `gcloud auth login`'d CLI.
 *
 * Run: node scripts/backtest-phase1.mjs
 *
 * Only meaningful once historicalRankings/priceHistory span a real window
 * (months+) — with only days of history, this is closer to "does the
 * pipeline work" than a real signal test. See CLAUDE.md's "Reusable
 * patterns" / project history for the real (Phase 2+) point-in-time
 * backtest this is a precursor to.
 */
import { execSync } from "node:child_process";

const PROJECT = "jj-analects-2-17";
const TOKEN = execSync("gcloud auth print-access-token").toString().trim();
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

function decodeValue(v) {
  if (v == null) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("mapValue" in v) return decodeFields(v.mapValue.fields || {});
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decodeValue);
  if ("timestampValue" in v) return v.timestampValue;
  return undefined;
}
function decodeFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = decodeValue(v);
  return out;
}
function decodeDoc(doc) {
  const parts = doc.name.split("/");
  return { id: parts[parts.length - 1], path: doc.name, ...decodeFields(doc.fields) };
}
function parentId(path, collectionName) {
  const parts = path.split("/");
  const idx = parts.indexOf(collectionName);
  return idx >= 0 ? parts[idx + 1] : null;
}

async function runQuery(body) {
  const res = await fetch(`${BASE}:runQuery`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!Array.isArray(json)) {
    console.error("Unexpected response:", JSON.stringify(json).slice(0, 500));
    return [];
  }
  return json.filter((x) => x.document).map((x) => x.document);
}

async function fetchAllCollectionGroup(collectionId, pageSize = 1000, allDescendants = true) {
  let all = [];
  let cursor = null;
  for (let page = 0; page < 50; page++) {
    const structuredQuery = {
      from: [{ collectionId, allDescendants }],
      orderBy: [{ field: { fieldPath: "__name__" }, direction: "ASCENDING" }],
      limit: pageSize,
    };
    if (cursor) structuredQuery.startAt = { values: [{ referenceValue: cursor }], before: false };
    const docs = await runQuery({ structuredQuery });
    all = all.concat(docs);
    if (docs.length < pageSize) break;
    cursor = docs[docs.length - 1].name;
  }
  return all;
}

console.log("Fetching historicalRankings snapshots...");
const snapshotDocs = (await fetchAllCollectionGroup("snapshots")).map((d) => ({
  ...decodeDoc(d),
  ticker: parentId(d.name, "historicalRankings"),
}));
console.log(`  ${snapshotDocs.length} snapshot docs`);

console.log("Fetching marketData...");
const marketDataDocs = (await fetchAllCollectionGroup("marketData")).map((d) => ({
  ...decodeDoc(d),
  ticker: parentId(d.name, "companies"),
}));
console.log(`  ${marketDataDocs.length} marketData docs`);

console.log("Fetching companies...");
// allDescendants=false: top-level "companies" only — collection-group "companies" would also match
// the unrelated rankings/latest/companies/{ticker} subcollection (RankingResult docs, no .latest field).
const companyDocs = (await fetchAllCollectionGroup("companies", 1000, false)).map((d) => decodeDoc(d));
console.log(`  ${companyDocs.length} company docs`);

// Earliest historicalRankings snapshot per ticker
const earliestSnapshotByTicker = new Map();
for (const s of snapshotDocs) {
  if (!s.ticker || !s.date) continue;
  const existing = earliestSnapshotByTicker.get(s.ticker);
  if (!existing || s.date < existing.date) earliestSnapshotByTicker.set(s.ticker, s);
}

// marketData points grouped by ticker
const marketDataByTicker = new Map();
for (const m of marketDataDocs) {
  if (!m.ticker || !m.date || m.sharePrice == null) continue;
  if (!marketDataByTicker.has(m.ticker)) marketDataByTicker.set(m.ticker, []);
  marketDataByTicker.get(m.ticker).push(m);
}

const companyByTicker = new Map(companyDocs.map((c) => [c.id, c]));

const MAX_DATE_GAP_DAYS = 14;
const rows = [];
for (const [ticker, snap] of earliestSnapshotByTicker) {
  if (snap.overallScore == null || snap.overallRank == null) continue;
  const points = marketDataByTicker.get(ticker);
  if (!points || points.length === 0) continue;
  const snapMs = new Date(snap.date).getTime();
  let best = null;
  let bestDiff = Infinity;
  for (const p of points) {
    const diff = Math.abs(new Date(p.date).getTime() - snapMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = p;
    }
  }
  const diffDays = bestDiff / (24 * 60 * 60 * 1000);
  if (!best || diffDays > MAX_DATE_GAP_DAYS || best.sharePrice <= 0) continue;

  const company = companyByTicker.get(ticker);
  const currentPrice = company?.latest?.sharePrice;
  if (currentPrice == null || currentPrice <= 0) continue;

  const forwardReturn = (currentPrice - best.sharePrice) / best.sharePrice;
  rows.push({
    ticker,
    snapDate: snap.date,
    priceDate: best.date,
    priceThen: best.sharePrice,
    priceNow: currentPrice,
    initialScore: snap.overallScore,
    initialRank: snap.overallRank,
    forwardReturn,
  });
}

console.log(`\nUsable rows (have both an early rank snapshot and a matched price then+now): ${rows.length}`);

if (rows.length < 10) {
  console.log("Too few usable rows for a meaningful bucket analysis. Dumping raw rows:");
  console.log(rows);
  process.exit(0);
}

rows.sort((a, b) => b.initialScore - a.initialScore);

const numBuckets = rows.length >= 50 ? 5 : rows.length >= 20 ? 4 : 3;
const bucketSize = Math.ceil(rows.length / numBuckets);
console.log(`\nBucketing into ${numBuckets} groups by initial overallScore (best to worst):\n`);
console.log("Bucket".padEnd(10), "N".padEnd(6), "AvgScore".padEnd(10), "AvgFwdRet".padEnd(12), "MedFwdRet".padEnd(12), "DateRange");

for (let b = 0; b < numBuckets; b++) {
  const chunk = rows.slice(b * bucketSize, (b + 1) * bucketSize);
  if (chunk.length === 0) continue;
  const avgScore = chunk.reduce((a, r) => a + r.initialScore, 0) / chunk.length;
  const avgRet = chunk.reduce((a, r) => a + r.forwardReturn, 0) / chunk.length;
  const sortedRet = [...chunk].map((r) => r.forwardReturn).sort((a, b2) => a - b2);
  const medRet = sortedRet[Math.floor(sortedRet.length / 2)];
  const dates = [...new Set(chunk.map((r) => r.snapDate))].sort();
  console.log(
    `${b + 1}`.padEnd(10),
    `${chunk.length}`.padEnd(6),
    avgScore.toFixed(1).padEnd(10),
    `${(avgRet * 100).toFixed(2)}%`.padEnd(12),
    `${(medRet * 100).toFixed(2)}%`.padEnd(12),
    dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]}..${dates[dates.length - 1]}`,
  );
}

const overallAvgRet = rows.reduce((a, r) => a + r.forwardReturn, 0) / rows.length;
console.log(`\nUniverse average forward return: ${(overallAvgRet * 100).toFixed(2)}%`);

// Simple Pearson correlation between initial rank (lower=better) and forward return
const n = rows.length;
const meanRank = rows.reduce((a, r) => a + r.initialRank, 0) / n;
const meanRet = rows.reduce((a, r) => a + r.forwardReturn, 0) / n;
let cov = 0,
  varRank = 0,
  varRet = 0;
for (const r of rows) {
  cov += (r.initialRank - meanRank) * (r.forwardReturn - meanRet);
  varRank += (r.initialRank - meanRank) ** 2;
  varRet += (r.forwardReturn - meanRet) ** 2;
}
const corr = cov / Math.sqrt(varRank * varRet);
console.log(`Correlation(initial rank, forward return): ${corr.toFixed(3)} (negative = better rank -> better return, as expected if the model works)`);
console.log(`\nDate span covered: ${[...new Set(rows.map((r) => r.snapDate))].sort().join(", ")}`);

console.log("\nAll rows sorted by forward return (checking for outliers/data errors):");
for (const r of [...rows].sort((a, b) => b.forwardReturn - a.forwardReturn)) {
  console.log(
    r.ticker.padEnd(8),
    `score=${r.initialScore.toFixed(1)}`.padEnd(12),
    `rank=${r.initialRank}`.padEnd(10),
    `then=$${r.priceThen.toFixed(2)}(${r.priceDate})`.padEnd(24),
    `now=$${r.priceNow.toFixed(2)}`.padEnd(14),
    `ret=${(r.forwardReturn * 100).toFixed(1)}%`,
  );
}
