import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, Plus, Star } from "lucide-react";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { ScorePill } from "../components/ui/ScorePill";
import { Logo } from "../components/ui/Logo";
import { cn } from "../lib/utils";

const NAV_SECTIONS = [
  { id: "features", label: "Features" },
  { id: "pricing", label: "Pricing" },
  { id: "faq", label: "FAQ" },
];

/** Highlights whichever section's midpoint is currently crossing a thin band near the top of the viewport. */
function useScrollSpy(ids: string[]): string {
  const [active, setActive] = useState(ids[0]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      { rootMargin: "-40% 0px -50% 0px", threshold: 0 },
    );
    const elements = ids.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => el !== null);
    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(",")]);

  return active;
}

function ScrollSpyNav() {
  const active = useScrollSpy(NAV_SECTIONS.map((s) => s.id));
  return (
    <nav className="hidden items-center gap-1 rounded-full border border-border bg-surface-muted p-1 md:flex">
      {NAV_SECTIONS.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          className={cn(
            "rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
            active === s.id ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2">
          <Logo className="h-4 w-4 shrink-0" />
          <span className="text-sm font-semibold">Analects 2.17</span>
        </Link>
        <ScrollSpyNav />
        <nav className="flex items-center gap-3">
          <Link to="/login" className="text-sm text-muted-foreground hover:text-foreground">
            Sign in
          </Link>
          <Link to="/login">
            <Button size="sm" className="rounded-full px-4">
              Get started
            </Button>
          </Link>
        </nav>
      </div>
    </header>
  );
}

const HERO_BADGES = ["70+ metrics", "Live weight sliders", "Updated daily"];

function Hero() {
  return (
    <section className="mx-auto max-w-4xl px-4 pb-20 pt-20 text-center sm:px-6 sm:pb-28 sm:pt-28">
      <h1 className="text-balance text-5xl font-bold tracking-tight sm:text-6xl md:text-7xl">
        Every company.
        <br />
        <span className="text-accent">Ranked, scored,</span> and explained.
      </h1>
      <p className="mx-auto mt-6 max-w-xl text-balance text-lg text-muted-foreground sm:text-xl">
        A multi-factor model scores every mid and large-cap company on valuation, momentum, profitability,
        growth, and more — then shows you exactly why.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        {HERO_BADGES.map((t) => (
          <span key={t} className="rounded-full border border-border bg-surface-muted px-3 py-1 text-xs text-muted-foreground">
            {t}
          </span>
        ))}
      </div>
      <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <Link to="/login">
          <Button size="lg" className="rounded-full px-7">
            Get started <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
        <span className="text-sm text-muted-foreground">7-day free trial · $2/month after · Cancel anytime</span>
      </div>
    </section>
  );
}

function RankedTableMockup() {
  const rows = [
    { ticker: "NVDA", sector: "Technology", score: 92.4 },
    { ticker: "LLY", sector: "Healthcare", score: 87.1 },
    { ticker: "COST", sector: "Consumer Staples", score: 81.6 },
    { ticker: "V", sector: "Technology", score: 78.9 },
  ];
  return (
    <div className="w-full max-w-sm overflow-hidden rounded-card border border-border bg-surface shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <span>Company</span>
        <span>Score</span>
      </div>
      {rows.map((r, i) => (
        <div key={r.ticker} className={`flex items-center justify-between px-4 py-3 ${i !== rows.length - 1 ? "border-b border-border" : ""}`}>
          <div className="flex items-center gap-3">
            <span className="w-4 text-sm text-muted-foreground">{i + 1}</span>
            <div>
              <div className="text-sm font-medium">{r.ticker}</div>
              <Badge variant="neutral" className="mt-0.5">
                {r.sector}
              </Badge>
            </div>
          </div>
          <ScorePill score={r.score} />
        </div>
      ))}
    </div>
  );
}

function WeightSlidersMockup() {
  const rows = [
    { label: "Valuation", pct: 20 },
    { label: "Profitability", pct: 15 },
    { label: "Growth", pct: 15 },
    { label: "Momentum", pct: 10 },
  ];
  return (
    <div className="w-full max-w-sm space-y-4 rounded-card border border-border bg-surface p-5 shadow-sm">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="mb-1.5 flex items-center justify-between text-sm">
            <span className="text-foreground/80">{r.label}</span>
            <span className="text-muted-foreground">{r.pct}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-surface-muted">
            <div className="h-1.5 rounded-full bg-accent" style={{ width: `${r.pct * 4}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function SectorGridMockup() {
  const sectors = [
    { name: "Technology", score: 74, size: "large" },
    { name: "Healthcare", score: 61, size: "medium" },
    { name: "Financials", score: 55, size: "medium" },
    { name: "Energy", score: 48, size: "small" },
    { name: "Industrials", score: 58, size: "small" },
    { name: "Materials", score: 44, size: "small" },
  ];
  const colorFor = (score: number) =>
    score >= 65 ? "bg-positive/15 text-positive" : score >= 50 ? "bg-accent/15 text-accent" : "bg-negative/15 text-negative";
  return (
    <div className="grid w-full max-w-sm grid-cols-3 gap-2">
      {sectors.map((s) => (
        <div
          key={s.name}
          className={`flex flex-col items-center justify-center gap-1 rounded-card border border-border p-4 text-center ${
            s.size === "large" ? "col-span-2 row-span-2" : ""
          } ${colorFor(s.score)}`}
        >
          <span className="text-xs font-medium">{s.name}</span>
          <span className="text-lg font-semibold">{s.score}</span>
        </div>
      ))}
    </div>
  );
}

function WatchlistMockup() {
  const rows = [
    { ticker: "MSFT", change: "+1.2%" },
    { ticker: "AAPL", change: "+0.4%" },
    { ticker: "AVGO", change: "-0.8%" },
  ];
  return (
    <div className="w-full max-w-sm space-y-2 rounded-card border border-border bg-surface p-4 shadow-sm">
      {rows.map((r) => (
        <div key={r.ticker} className="flex items-center justify-between rounded-md px-2 py-2 hover:bg-surface-hover">
          <div className="flex items-center gap-2">
            <Star className="h-3.5 w-3.5 fill-accent text-accent" />
            <span className="text-sm font-medium">{r.ticker}</span>
          </div>
          <span className={`text-xs ${r.change.startsWith("-") ? "text-negative" : "text-positive"}`}>{r.change}</span>
        </div>
      ))}
    </div>
  );
}

const FEATURE_CARDS = [
  {
    tag: "RANKINGS",
    title: "Every company, every metric.",
    body: "~70 metrics across valuation, momentum, profitability, growth, cash generation, financial strength, capital allocation, efficiency, earnings quality, and competitive moat — normalized cross-sectionally into one score per company.",
    visual: <RankedTableMockup />,
  },
  {
    tag: "CUSTOM MODELS",
    title: "Make the model yours.",
    body: "Disagree with the default weighting? Drag the sliders. Reweight entire categories or individual metrics, and the whole universe re-ranks live.",
    visual: <WeightSlidersMockup />,
  },
  {
    tag: "SECTOR VIEW",
    title: "See the whole market at once.",
    body: "A treemap and heatmap surface exactly where value, quality, and momentum concentrate — and where they don't — across every sector.",
    visual: <SectorGridMockup />,
  },
  {
    tag: "WATCHLIST",
    title: "Never lose track of what matters.",
    body: "Star the companies you're following and check back any time — scores and ranks update as new filings and prices come in.",
    visual: <WatchlistMockup />,
  },
];

function FeatureGrid() {
  return (
    <section id="features" className="mx-auto max-w-6xl scroll-mt-16 px-4 py-20 sm:px-6 sm:py-28">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
          Made for <span className="text-accent">serious</span> research.
        </h2>
        <p className="mt-4 text-balance text-base text-muted-foreground sm:text-lg">
          Every tool is built around one idea: show the number, then show exactly why.
        </p>
      </div>
      <div className="mt-14 grid gap-5 sm:grid-cols-2">
        {FEATURE_CARDS.map((f) => (
          <div key={f.tag} className="flex flex-col rounded-card border border-border bg-surface p-6 transition-shadow hover:shadow-md">
            <div className="flex justify-center rounded-md bg-surface-muted p-6">{f.visual}</div>
            <p className="mt-5 text-xs font-semibold tracking-wide text-accent">{f.tag}</p>
            <h3 className="mt-1.5 text-xl font-semibold tracking-tight">{f.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function PricingSection() {
  return (
    <section id="pricing" className="mx-auto max-w-2xl scroll-mt-16 px-4 py-20 text-center sm:px-6 sm:py-28">
      <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">Simple, transparent pricing</h2>
      <div className="mt-8 rounded-card border border-border bg-surface p-8 shadow-sm">
        <div className="flex items-baseline justify-center gap-1">
          <span className="text-5xl font-semibold tracking-tight">$2</span>
          <span className="text-muted-foreground">/month</span>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">First 7 days free. Cancel anytime.</p>
        <ul className="mx-auto mt-6 flex max-w-xs flex-col gap-2 text-left text-sm">
          {[
            "Every mid & large-cap company, ranked",
            "Full metric breakdown per company",
            "Live weight sliders & custom models",
            "CSV / JSON / XLSX export",
          ].map((f) => (
            <li key={f} className="flex items-start gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-positive" />
              <span className="text-foreground/80">{f}</span>
            </li>
          ))}
        </ul>
        <Link to="/login" className="mt-7 block">
          <Button size="lg" className="w-full rounded-full">
            Start your free trial
          </Button>
        </Link>
      </div>
    </section>
  );
}

const FAQS = [
  {
    q: 'What counts as "mid and large-cap"?',
    a: "The ranked universe is data-driven: every SEC-registered company is screened, and anything above roughly a $2B market cap qualifies — no hand-picked index list.",
  },
  {
    q: "Where does the data come from?",
    a: "Live prices from Yahoo Finance and official financial statements from SEC EDGAR — refreshed daily.",
  },
  {
    q: "How is the score calculated?",
    a: "Each metric is ranked cross-sectionally against every other company (percentile or z-score), combined across up to 5 fiscal years with heavier weight on recent years, then rolled up into category and overall scores using the weights you choose.",
  },
  {
    q: "Can I change how it's weighted?",
    a: "Yes — every category and individual metric has a live weight slider on the Rankings page. The whole universe re-ranks instantly, no waiting for a batch job.",
  },
  {
    q: "Is this investment advice?",
    a: "No. Analects 2.17 is a research and screening tool, not investment advice.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes, from the billing portal — no phone calls, no retention flow.",
  },
];

function FaqSection() {
  return (
    <section id="faq" className="mx-auto max-w-3xl scroll-mt-16 px-4 py-20 sm:px-6 sm:py-28">
      <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">Frequently asked questions</h2>
      <div className="mt-8 divide-y divide-border rounded-card border border-border">
        {FAQS.map((f) => (
          <details key={f.q} className="group px-5 py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium">
              {f.q}
              <Plus className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-45" />
            </summary>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <Hero />
      <FeatureGrid />
      <PricingSection />
      <FaqSection />

      <footer className="border-t border-border px-4 py-8 text-center text-xs text-muted-foreground sm:px-6">
        Analects 2.17 — "When you know a thing, to hold that you know it; and when you do not know a thing, to
        allow that you do not know it — this is knowledge." Data from Yahoo Finance and SEC EDGAR; not investment
        advice.
      </footer>
    </div>
  );
}
