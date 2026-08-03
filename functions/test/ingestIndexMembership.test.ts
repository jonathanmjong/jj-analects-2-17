import { describe, expect, it } from "vitest";
import { parseSp500Html } from "../src/ingestion/ingestIndexMembership.js";

function wikiTable(rows: string): string {
  return `<table class="wikitable sortable" id="constituents">${rows}</table>`;
}

describe("parseSp500Html", () => {
  // Regression test: Wikipedia switched from bare <tr>/<td> to id-attributed
  // <tr id="mwLQ">/<td id="mwLg"> tags, which silently zeroed out every parsed
  // ticker for two days straight ("Suspiciously few tickers parsed (0)") before
  // the safety guard aborted the membership overwrite. This fixture mirrors the
  // real markup shape, including the multi-attribute <a> that wraps the ticker.
  it("parses tickers from rows with id-attributed <tr>/<td> tags", () => {
    const rows = `
      <tr id="mwLQ">
      <td id="mwLg"><a rel="mw:ExtLink nofollow" href="https://www.nyse.com/quote/XNYS:MMM" class="external text" id="mwLw" data-mw='{"parts":[{"template":{"target":{"wt":"NyseSymbol"},"params":{"1":{"wt":"MMM"}}}}]}'>MMM</a></td>
      <td id="mwMA"><a rel="mw:WikiLink" href="https://en.wikipedia.org/wiki/3M" title="3M">3M</a></td><td>Industrials</td></tr>
      <tr id="mwNQ">
      <td id="mwNg"><a rel="mw:ExtLink nofollow" href="https://www.nyse.com/quote/XNYS:AOS" class="external text">AOS</a></td>
      <td><a href="https://en.wikipedia.org/wiki/A._O._Smith" title="A. O. Smith">A. O. Smith</a></td><td>Industrials</td></tr>
    `;
    const tickers = parseSp500Html(wikiTable(rows));
    expect(tickers).toEqual(["MMM", "AOS"]);
  });

  it("still parses bare <tr>/<td> tags (pre-change markup)", () => {
    const rows = `<tr><td><a href="x">MMM</a></td><td>3M</td></tr>`;
    expect(parseSp500Html(wikiTable(rows))).toEqual(["MMM"]);
  });

  it("throws if the constituents table is missing", () => {
    expect(() => parseSp500Html("<html><body>no table here</body></html>")).toThrow(
      "constituents table not found",
    );
  });

  it("returns an empty array (not a throw) when the table has no matching rows", () => {
    expect(parseSp500Html(wikiTable("<tr><td>no anchor here</td></tr>"))).toEqual([]);
  });
});
