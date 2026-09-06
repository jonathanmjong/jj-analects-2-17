import { describe, expect, it } from "vitest";
import { replaceOnce, stripHomepageStructuredData, renderPageHtml, buildRouteList, buildSitemap } from "./prerenderMeta.mjs";

const TEMPLATE = `<!doctype html>
<html><head>
<title>Stock Screener &amp; Ranking Tool for Value Investing | Analects 2.17</title>
<meta name="description" content="Screen and rank every mid & large-cap stock on ~70 fundamental metrics — valuation, momentum, profitability, growth. A fundamental analysis and value investing tool for serious investors. 7-day free trial, $2/month." />
<link rel="canonical" href="https://analects2.com/" />
<meta property="og:url" content="https://analects2.com/" />
<meta property="og:title" content="Stock Screener & Ranking Tool for Value Investing | Analects 2.17" />
<meta property="og:description" content="Screen and rank every mid & large-cap stock on ~70 fundamental metrics — valuation, momentum, profitability, growth. Built for value investing and fundamental analysis." />
<meta name="twitter:title" content="Stock Screener & Ranking Tool for Value Investing | Analects 2.17" />
<meta name="twitter:description" content="Screen and rank every mid & large-cap stock on ~70 fundamental metrics — valuation, momentum, profitability, growth. Built for value investing and fundamental analysis." />
<script type="application/ld+json">{"@type":"SoftwareApplication"}</script>
<script type="application/ld+json">{"@type":"FAQPage"}</script>
</head><body><div id="root"></div><script type="module" src="/assets/index-XYZ.js"></script></body></html>
`;

describe("replaceOnce", () => {
  it("replaces a string that appears exactly once", () => {
    expect(replaceOnce("abc", "b", "X")).toBe("aXc");
  });

  it("throws when the target is missing (would silently ship the wrong canonical)", () => {
    expect(() => replaceOnce("abc", "zzz", "X")).toThrow(/found 0/);
  });

  it("throws when the target is ambiguous, rather than guessing which one to replace", () => {
    expect(() => replaceOnce("abcabc", "abc", "X")).toThrow(/found 2/);
  });
});

describe("stripHomepageStructuredData", () => {
  it("removes every JSON-LD script block", () => {
    const out = stripHomepageStructuredData(TEMPLATE);
    expect(out).not.toContain("application/ld+json");
    expect(out).not.toContain("SoftwareApplication");
    expect(out).not.toContain("FAQPage");
  });

  it("leaves everything else untouched", () => {
    const out = stripHomepageStructuredData(TEMPLATE);
    expect(out).toContain('<script type="module" src="/assets/index-XYZ.js"></script>');
  });
});

describe("renderPageHtml", () => {
  it("gives the page its own self-referencing canonical, not the homepage's", () => {
    const html = renderPageHtml(TEMPLATE, { path: "/login", title: "Sign In | Analects 2.17", description: "Sign in." });
    expect(html).toContain('<link rel="canonical" href="https://analects2.com/login" />');
    expect(html).not.toContain('href="https://analects2.com/"');
  });

  it("rewrites title, description, and both og/twitter mirrors consistently", () => {
    const html = renderPageHtml(TEMPLATE, { path: "/preview", title: "Preview Title", description: "Preview description." });
    expect(html).toContain("<title>Preview Title</title>");
    expect(html.match(/Preview Title/g)).toHaveLength(3); // title, og:title, twitter:title
    expect(html.match(/Preview description\./g)).toHaveLength(3); // meta description, og:description, twitter:description
  });

  it("HTML-escapes an ampersand in the title (og/twitter attributes tolerate raw &, <title> does not)", () => {
    const html = renderPageHtml(TEMPLATE, { path: "/vs/a-and-b", title: "A & B", description: "d" });
    expect(html).toContain("<title>A &amp; B</title>");
  });

  it("strips homepage-specific structured data from every non-home page", () => {
    const html = renderPageHtml(TEMPLATE, { path: "/login", title: "t", description: "d" });
    expect(html).not.toContain("application/ld+json");
  });

  it("never leaves the homepage's canonical or og:url behind", () => {
    const html = renderPageHtml(TEMPLATE, { path: "/vs/finviz", title: "t", description: "d" });
    expect(html).not.toMatch(/href="https:\/\/analects2\.com\/"/);
    expect(html).not.toMatch(/og:url" content="https:\/\/analects2\.com\/"/);
  });
});

describe("buildRouteList", () => {
  it("includes login and preview unconditionally", () => {
    const paths = buildRouteList({}).map((r) => r.path);
    expect(paths).toContain("/login");
    expect(paths).toContain("/preview");
  });

  it("adds one /vs/<slug> route per competitor entry, so a new entry can never be forgotten here", () => {
    const routes = buildRouteList({ finviz: { name: "Finviz" }, acme: { name: "Acme" } });
    const paths = routes.map((r) => r.path);
    expect(paths).toContain("/vs/finviz");
    expect(paths).toContain("/vs/acme");
  });

  it("names the competitor in both the title and the description", () => {
    const [route] = buildRouteList({ finviz: { name: "Finviz" } }).filter((r) => r.path === "/vs/finviz");
    expect(route.title).toContain("Finviz");
    expect(route.description).toContain("Finviz");
  });
});

describe("buildSitemap", () => {
  it("always includes the homepage first, at priority 1.0", () => {
    const xml = buildSitemap([]);
    expect(xml.indexOf("<loc>https://analects2.com/</loc>")).toBeGreaterThan(-1);
    expect(xml.indexOf("<loc>https://analects2.com/</loc>")).toBeLessThan(xml.indexOf("</urlset>"));
  });

  it("includes exactly one <url> entry per route plus the homepage", () => {
    const routes = buildRouteList({ finviz: { name: "Finviz" }, "stock-rover": { name: "Stock Rover" } });
    const xml = buildSitemap(routes);
    expect((xml.match(/<url>/g) ?? []).length).toBe(routes.length + 1);
  });

  it("is valid enough XML to at least balance every tag it opens", () => {
    const xml = buildSitemap(buildRouteList({ finviz: { name: "Finviz" } }));
    const opens = xml.match(/<url>/g)?.length ?? 0;
    const closes = xml.match(/<\/url>/g)?.length ?? 0;
    expect(opens).toBe(closes);
  });
});
