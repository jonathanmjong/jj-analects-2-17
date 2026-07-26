import { Star } from "lucide-react";
import { Badge } from "../ui/Badge";
import { ScorePill } from "../ui/ScorePill";

/** Illustrative product mockups shared between the landing page and the login page graphic — not live data. */

export function RankedTableMockup() {
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

export function WeightSlidersMockup() {
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

export function WaterfallMockup() {
  const rows = [
    { label: "Revenue", value: "$94.9B", pct: 100 },
    { label: "Operating Income", value: "$31.5B", pct: 58 },
    { label: "Net Income", value: "$24.2B", pct: 44 },
  ];
  return (
    <div className="w-full max-w-sm space-y-4 rounded-card border border-border bg-surface p-5 shadow-sm">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="mb-1.5 flex items-center justify-between text-sm">
            <span className="text-foreground/80">{r.label}</span>
            <span className="font-medium text-foreground">{r.value}</span>
          </div>
          <div className="h-2 w-full rounded-full bg-surface-muted">
            <div className="h-2 rounded-full bg-accent" style={{ width: `${r.pct}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function WatchlistMockup() {
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

/** Wide "browser chrome" preview card used as the landing page's hero visual. */
export function HeroPreviewMockup() {
  const rows = [
    { rank: 1, ticker: "NVDA", sector: "Technology", score: 92.4 },
    { rank: 2, ticker: "LLY", sector: "Healthcare", score: 87.1 },
    { rank: 3, ticker: "COST", sector: "Consumer Staples", score: 81.6 },
    { rank: 4, ticker: "V", sector: "Technology", score: 78.9 },
    { rank: 5, ticker: "MA", sector: "Technology", score: 76.2 },
  ];
  return (
    <div className="relative mx-auto mt-14 max-w-2xl">
      <div className="pointer-events-none absolute -top-10 left-[15%] h-40 w-40 rounded-full bg-accent/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-10 right-[15%] h-40 w-40 rounded-full bg-positive/20 blur-3xl" />
      <div className="relative overflow-hidden rounded-card border border-border bg-surface text-left shadow-xl">
        <div className="flex items-center gap-1.5 border-b border-border bg-surface-muted px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-negative/40" />
          <span className="h-2.5 w-2.5 rounded-full bg-accent/40" />
          <span className="h-2.5 w-2.5 rounded-full bg-positive/40" />
          <span className="ml-2 text-xs text-muted-foreground">analects2.com/rankings</span>
        </div>
        <div className="flex items-center gap-3 border-b border-border px-5 py-2.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <span className="w-6">Rank</span>
          <span className="flex-1">Company</span>
          <span className="w-28">Sector</span>
          <span className="w-12 text-right">Score</span>
        </div>
        {rows.map((r) => (
          <div key={r.ticker} className="flex items-center gap-3 border-b border-border px-5 py-3 last:border-b-0">
            <span className="w-6 text-sm text-muted-foreground">{r.rank}</span>
            <span className="flex-1 text-sm font-medium">{r.ticker}</span>
            <Badge variant="neutral" className="w-28 justify-center">
              {r.sector}
            </Badge>
            <span className="w-12 text-right">
              <ScorePill score={r.score} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
