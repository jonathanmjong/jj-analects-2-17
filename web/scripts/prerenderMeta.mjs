#!/usr/bin/env node
// @ts-check
/**
 * Postbuild step: gives every public, indexable route its own static HTML file
 * with a self-referencing canonical URL, instead of every route serving the
 * one dist/index.html whose <link rel="canonical"> always points at "/".
 *
 * That was the root cause of Search Console's "Duplicate, Google chose
 * different canonical than user": Googlebot fetches /login, /preview, and
 * every /vs/:slug page and finds byte-identical HTML declaring the homepage
 * as canonical for all of them. Given that contradiction it ignores the
 * declared tag and picks its own — which is exactly the reported symptom.
 *
 * This app has no SSR framework, but the set of public routes is small and
 * fixed (home, login, preview, and one page per entry in competitors.json),
 * so full prerendering isn't needed — only the <head> metadata needs to
 * differ per URL. Firebase Hosting serves an exact static file over the
 * "**" -> /index.html rewrite (the same directory-index behavior every static
 * host uses), so writing dist/login/index.html etc. is enough on its own —
 * no firebase.json change required. Asset paths in the built HTML are root-
 * absolute (/assets/...), so nesting the file into a subdirectory is safe.
 *
 * Gated app routes (/rankings, /company/:ticker, ...) are untouched — they
 * stay disallowed in robots.txt and were never part of this problem.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(__dirname, "..");
const DIST = join(WEB_ROOT, "dist");
const SITE_URL = "https://analects2.com";

/**
 * One exact tag-for-tag replacement. Throws if the target isn't found in the
 * template exactly once — matching on the FULL tag (not a content fragment)
 * so tags that happen to share the same text, like og:description and
 * twitter:description, never collide. A silent no-op or an ambiguous match
 * here would ship a page with the wrong canonical, which is the bug this
 * script exists to prevent, so failing the build loudly is the right choice.
 */
export function replaceOnce(html, search, replacement) {
  const count = html.split(search).length - 1;
  if (count !== 1) {
    throw new Error(`Expected exactly one occurrence of ${JSON.stringify(search)}, found ${count}`);
  }
  return html.replace(search, replacement);
}

/** Strips the two homepage-specific JSON-LD blocks (SoftwareApplication, FAQPage) from a page
 * that isn't the homepage — repeating them verbatim on every route is itself a same-content
 * signal, on top of describing a page ("the FAQ", "the software product") that isn't this one. */
export function stripHomepageStructuredData(html) {
  return html.replace(/\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/g, "");
}

const esc = (s) => s.replace(/&/g, "&amp;");

/**
 * Rewrites the shared <head> template for one route: title, meta description,
 * canonical link, and the Open Graph / Twitter mirrors of both. `templateHtml`
 * is the built dist/index.html, already correct for "/" — every other route
 * is derived from it by substitution, never hand-duplicated, so this file and
 * index.html's defaults can never drift apart the way per-page hardcoded
 * copies once could.
 */
export function renderPageHtml(templateHtml, { path, title, description }) {
  const url = `${SITE_URL}${path}`;
  let html = templateHtml;

  html = replaceOnce(
    html,
    '<title>Stock Screener &amp; Ranking Tool for Value Investing | Analects 2.17</title>',
    `<title>${esc(title)}</title>`,
  );
  html = replaceOnce(
    html,
    '<meta name="description" content="Screen and rank every mid & large-cap stock on ~70 fundamental metrics — valuation, momentum, profitability, growth. A fundamental analysis and value investing tool for serious investors. 7-day free trial, $2/month." />',
    `<meta name="description" content="${description}" />`,
  );
  html = replaceOnce(
    html,
    '<link rel="canonical" href="https://analects2.com/" />',
    `<link rel="canonical" href="${url}" />`,
  );
  html = replaceOnce(
    html,
    '<meta property="og:url" content="https://analects2.com/" />',
    `<meta property="og:url" content="${url}" />`,
  );
  html = replaceOnce(
    html,
    '<meta property="og:title" content="Stock Screener & Ranking Tool for Value Investing | Analects 2.17" />',
    `<meta property="og:title" content="${title}" />`,
  );
  html = replaceOnce(
    html,
    '<meta property="og:description" content="Screen and rank every mid & large-cap stock on ~70 fundamental metrics — valuation, momentum, profitability, growth. Built for value investing and fundamental analysis." />',
    `<meta property="og:description" content="${description}" />`,
  );
  html = replaceOnce(
    html,
    '<meta name="twitter:title" content="Stock Screener & Ranking Tool for Value Investing | Analects 2.17" />',
    `<meta name="twitter:title" content="${title}" />`,
  );
  html = replaceOnce(
    html,
    '<meta name="twitter:description" content="Screen and rank every mid & large-cap stock on ~70 fundamental metrics — valuation, momentum, profitability, growth. Built for value investing and fundamental analysis." />',
    `<meta name="twitter:description" content="${description}" />`,
  );

  return stripHomepageStructuredData(html);
}

/** The public route list. Home is left as dist/index.html (already correct); every other route
 * gets its own file written to dist/<path>/index.html. Titles/descriptions mirror what
 * useDocumentMeta already sets client-side for these same pages, so the pre-JS HTML and the
 * post-hydration DOM agree instead of flashing a different title. */
export function buildRouteList(competitors) {
  const routes = [
    {
      path: "/login",
      title: "Sign In | Analects 2.17",
      description: "Sign in with Google to start your 7-day free trial of Analects 2.17's multi-factor stock ranking model.",
      changefreq: "monthly",
      priority: "0.5",
    },
    {
      path: "/preview",
      title: "Top 20 Ranked Stocks (Free Preview) | Analects 2.17",
      description:
        "See the current top 20 highest-scoring stocks from Analects 2.17's multi-factor ranking model — no signup required. Full universe and live weight sliders require an account.",
      changefreq: "daily",
      priority: "0.8",
    },
  ];
  for (const [slug, config] of Object.entries(competitors)) {
    routes.push({
      path: `/vs/${slug}`,
      title: `Analects 2.17 vs ${config.name} — Stock Screener Comparison`,
      description: `See how Analects 2.17 compares to ${config.name}: pricing, live weight sliders, cross-sectional scoring across ~70 fundamental metrics, and more.`,
      changefreq: "monthly",
      priority: "0.7",
    });
  }
  return routes;
}

/** Regenerated from the same route list every build, so a route can never exist without also
 * being in the sitemap (or vice versa) the way the previously hand-maintained file could drift. */
export function buildSitemap(routes) {
  const urls = [{ path: "/", changefreq: "weekly", priority: "1.0" }, ...routes];
  const body = urls
    .map(
      (r) =>
        `  <url>\n    <loc>${SITE_URL}${r.path}</loc>\n    <changefreq>${r.changefreq}</changefreq>\n    <priority>${r.priority}</priority>\n  </url>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

/**
 * Does the actual build: read the built homepage HTML and the competitor list,
 * derive every route's page from them, write each to disk, and regenerate the
 * sitemap alongside them. Kept separate from module load (see build.mjs) so
 * this file has no import-time side effects — a test can import its pure
 * functions without triggering filesystem I/O or an "am I the entrypoint"
 * check, which is its own source of cross-runner fragility (comparing
 * import.meta.url against process.argv[1] behaves differently across
 * runners/bundlers and crashed Vitest's worker bootstrap here).
 */
export function run() {
  const templateHtml = readFileSync(join(DIST, "index.html"), "utf8");
  const competitors = JSON.parse(readFileSync(join(WEB_ROOT, "src/data/competitors.json"), "utf8"));
  const routes = buildRouteList(competitors);

  for (const route of routes) {
    const html = renderPageHtml(templateHtml, route);
    const outDir = join(DIST, route.path);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "index.html"), html);
    console.log(`prerenderMeta: wrote ${route.path}/index.html (canonical ${SITE_URL}${route.path})`);
  }

  const sitemap = buildSitemap(routes);
  writeFileSync(join(DIST, "sitemap.xml"), sitemap);
  console.log(`prerenderMeta: wrote sitemap.xml (${routes.length + 1} urls) — generated from the same route list, so it cannot drift`);
}
