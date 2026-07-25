import { Link } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  Check,
  GitCompare,
  PieChart,
  SlidersHorizontal,
  Star,
} from "lucide-react";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { ScorePill } from "../components/ui/ScorePill";

function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2">
          <span className="text-base leading-none">📈</span>
          <span className="text-sm font-semibold">Analects 2.17</span>
        </Link>
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

function Hero() {
  return (
    <section className="mx-auto max-w-4xl px-4 pb-20 pt-20 text-center sm:px-6 sm:pb-28 sm:pt-28">
      <h1 className="text-balance text-5xl font-semibold tracking-tight sm:text-6xl md:text-7xl">
        Every company.
        <br />
        Ranked, scored, and explained.
      </h1>
      <p className="mx-auto mt-6 max-w-xl text-balance text-lg text-muted-foreground sm:text-xl">
        A multi-factor model scores every mid and large-cap company on valuation, momentum, profitability,
        growth, and more — then shows you exactly why.
      </p>
      <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
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

interface FeatureSectionProps {
  eyebrow: string;
  title: string;
  body: string;
  reverse?: boolean;
  muted?: boolean;
  visual: React.ReactNode;
}

function FeatureSection({ eyebrow, title, body, reverse, muted, visual }: FeatureSectionProps) {
  return (
    <section className={muted ? "bg-surface-muted" : undefined}>
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <div className={`grid items-center gap-12 md:grid-cols-2 md:gap-16 ${reverse ? "md:[&>*:first-child]:order-2" : ""}`}>
          <div>
            <p className="text-sm font-medium text-accent">{eyebrow}</p>
            <h2 className="mt-2 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
            <p className="mt-4 text-balance text-base leading-relaxed text-muted-foreground sm:text-lg">{body}</p>
          </div>
          <div className="flex justify-center">{visual}</div>
        </div>
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

const FEATURES = [
  { icon: BarChart3, label: "70+ metrics, 10 categories" },
  { icon: SlidersHorizontal, label: "Reweight the model live" },
  { icon: PieChart, label: "Sector heatmaps & treemaps" },
  { icon: GitCompare, label: "Head-to-head comparisons" },
];

function PricingSection() {
  return (
    <section className="mx-auto max-w-2xl px-4 py-20 text-center sm:px-6 sm:py-28">
      <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">Simple, transparent pricing</h2>
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

export function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <Hero />

      <div className="border-y border-border bg-surface-muted">
        <div className="mx-auto grid max-w-5xl grid-cols-2 gap-6 px-4 py-10 sm:px-6 md:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.label} className="flex flex-col items-center gap-2 text-center">
              <f.icon className="h-5 w-5 text-accent" />
              <span className="text-xs text-muted-foreground">{f.label}</span>
            </div>
          ))}
        </div>
      </div>

      <FeatureSection
        eyebrow="RANKINGS"
        title="Every company, every metric."
        body="~70 metrics across valuation, momentum, profitability, growth, cash generation, financial strength, capital allocation, efficiency, earnings quality, and competitive moat — normalized cross-sectionally and combined into one score per company."
        visual={<RankedTableMockup />}
      />

      <FeatureSection
        eyebrow="CUSTOM MODELS"
        title="Make the model yours."
        body="Disagree with the default weighting? Drag the sliders. Reweight entire categories or individual metrics, and the whole universe re-ranks live — no waiting for a nightly batch job."
        reverse
        muted
        visual={<WeightSlidersMockup />}
      />

      <FeatureSection
        eyebrow="SECTOR VIEW"
        title="See the whole market at once."
        body="A treemap and heatmap surface exactly where value, quality, and momentum concentrate — and where they don't — across every sector in the ranked universe."
        visual={<SectorGridMockup />}
      />

      <FeatureSection
        eyebrow="WATCHLIST"
        title="Never lose track of what matters."
        body="Star the companies you're following and check back any time — scores and ranks update as new filings and prices come in."
        reverse
        muted
        visual={<WatchlistMockup />}
      />

      <PricingSection />

      <footer className="border-t border-border px-4 py-8 text-center text-xs text-muted-foreground sm:px-6">
        Analects 2.17 — "When you know a thing, to hold that you know it; and when you do not know a thing, to
        allow that you do not know it — this is knowledge." Data from Yahoo Finance and SEC EDGAR; not investment
        advice.
      </footer>
    </div>
  );
}
