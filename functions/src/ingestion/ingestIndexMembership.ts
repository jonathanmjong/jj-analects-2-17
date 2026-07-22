import { collections, FieldValue } from "../lib/firestore.js";
import { log } from "../lib/logger.js";

const WIKI_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies";
const USER_AGENT = "Proverbs21-5 research app (contact: jonathanmjong@gmail.com)";

/**
 * Keyless S&P 500 constituent list, scraped from Wikipedia's maintained
 * table. Fragile by nature (HTML structure can change) — wrapped in a
 * try/catch by the scheduled job so a parse failure never takes down the
 * rest of the daily refresh pipeline.
 */
export async function fetchSp500Tickers(): Promise<string[]> {
  const res = await fetch(WIKI_URL, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Wikipedia fetch failed: ${res.status}`);
  const html = await res.text();

  const tableMatch = html.match(/<table[^>]*id="constituents"[\s\S]*?<\/table>/);
  if (!tableMatch) throw new Error("constituents table not found in Wikipedia page");

  const rows = [...tableMatch[0].matchAll(/<tr>[\s\S]*?<\/tr>/g)];
  const tickers: string[] = [];
  for (const row of rows) {
    const cellMatch = row[0].match(/<td><a[^>]*>([A-Z.\-]+)<\/a><\/td>/);
    if (cellMatch) tickers.push(cellMatch[1]);
  }
  return tickers;
}

export async function refreshSp500Membership(): Promise<{ succeeded: string[]; failed: Array<{ ticker: string; error: string }> }> {
  try {
    const tickers = await fetchSp500Tickers();
    if (tickers.length < 400) {
      throw new Error(`Suspiciously few tickers parsed (${tickers.length}); aborting membership overwrite`);
    }

    const currentSp500 = await collections.companies().where("isSp500", "==", true).get();
    const toClear = currentSp500.docs.map((d) => d.id).filter((t) => !tickers.includes(t));

    const writes = [
      ...tickers.map((t) =>
        collections.company(t).set({ isSp500: true, updatedAt: new Date().toISOString() }, { merge: true }),
      ),
      ...toClear.map((t) =>
        collections.company(t).set({ isSp500: false, updatedAt: new Date().toISOString() }, { merge: true }),
      ),
    ];
    await Promise.all(writes);

    return { succeeded: tickers, failed: [] };
  } catch (err) {
    log.error("refreshSp500Membership failed", err);
    return { succeeded: [], failed: [{ ticker: "*", error: err instanceof Error ? err.message : String(err) }] };
  }
}
