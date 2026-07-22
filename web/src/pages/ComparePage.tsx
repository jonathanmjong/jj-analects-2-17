import { useState } from "react";
import { X } from "lucide-react";
import { METRIC_CATEGORIES } from "@proverbs/shared";
import { useMultiCompanyDetail } from "../hooks/useMultiCompanyDetail";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { ScorePill } from "../components/ui/ScorePill";
import { SpiderChart } from "../components/charts/SpiderChart";
import { formatCurrency } from "../lib/utils";

const CATEGORY_LABELS: Record<string, string> = {
  valuation: "Valuation",
  profitability: "Profitability",
  growth: "Growth",
  cashGeneration: "Cash Generation",
  financialStrength: "Financial Strength",
  capitalAllocation: "Capital Allocation",
  efficiency: "Efficiency",
  earningsQuality: "Earnings Quality",
  moat: "Competitive Moat",
};

const SERIES_COLORS = [
  "var(--color-accent)",
  "#4C6EF5",
  "#3D7A5C",
  "#BF4C44",
  "#9C6ADE",
  "#D4A72C",
  "#2FA3B3",
  "#E0668C",
  "#6D8A96",
  "#B4652F",
];

const MAX_COMPANIES = 10;
const MIN_COMPANIES = 2;

export function ComparePage() {
  const [tickers, setTickers] = useState<string[]>(["AAPL", "MSFT"]);
  const [input, setInput] = useState("");
  const { data: rows, isLoading } = useMultiCompanyDetail(tickers);

  function addTicker() {
    const symbol = input.trim().toUpperCase();
    if (!symbol || tickers.includes(symbol) || tickers.length >= MAX_COMPANIES) return;
    setTickers([...tickers, symbol]);
    setInput("");
  }

  function removeTicker(symbol: string) {
    setTickers(tickers.filter((t) => t !== symbol));
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Compare</h1>
        <p className="text-muted-foreground">Compare 2–10 companies across every factor category.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {tickers.map((t, idx) => (
          <span
            key={t}
            className="flex items-center gap-1 rounded-full px-3 py-1 text-sm font-medium"
            style={{ backgroundColor: `color-mix(in srgb, ${SERIES_COLORS[idx % SERIES_COLORS.length]} 15%, transparent)`, color: SERIES_COLORS[idx % SERIES_COLORS.length] }}
          >
            {t}
            <button onClick={() => removeTicker(t)} aria-label={`Remove ${t}`}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {tickers.length < MAX_COMPANIES && (
          <div className="flex items-center gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTicker()}
              placeholder="Add ticker…"
              className="h-9 w-32"
            />
            <Button size="sm" variant="outline" onClick={addTicker}>
              Add
            </Button>
          </div>
        )}
      </div>

      {tickers.length < MIN_COMPANIES && <p className="text-sm text-muted-foreground">Add at least 2 companies to compare.</p>}

      {isLoading && <p className="text-muted-foreground">Loading…</p>}

      {rows && rows.length >= MIN_COMPANIES && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Category Score Comparison</CardTitle>
            </CardHeader>
            <CardContent>
              <SpiderChart
                categories={METRIC_CATEGORIES.map((c) => CATEGORY_LABELS[c])}
                series={rows.map((row, idx) => ({
                  name: row.ticker,
                  color: SERIES_COLORS[idx % SERIES_COLORS.length],
                  values: Object.fromEntries(
                    (row.ranking?.categoryScores ?? []).map((c) => [CATEGORY_LABELS[c.category], (c.score ?? 0) * 100]),
                  ),
                }))}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Overview</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-4">Metric</th>
                    {rows.map((r) => (
                      <th key={r.ticker} className="py-2 pr-4">{r.ticker}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-border">
                    <td className="py-2 pr-4 text-muted-foreground">Overall Score</td>
                    {rows.map((r) => (
                      <td key={r.ticker} className="py-2 pr-4"><ScorePill score={r.ranking?.overallScore ?? null} /></td>
                    ))}
                  </tr>
                  <tr className="border-t border-border">
                    <td className="py-2 pr-4 text-muted-foreground">Sector</td>
                    {rows.map((r) => (
                      <td key={r.ticker} className="py-2 pr-4">{r.company?.sector ?? "—"}</td>
                    ))}
                  </tr>
                  <tr className="border-t border-border">
                    <td className="py-2 pr-4 text-muted-foreground">Market Cap</td>
                    {rows.map((r) => (
                      <td key={r.ticker} className="py-2 pr-4">{formatCurrency(r.company?.latest?.marketCap ?? null, { compact: true })}</td>
                    ))}
                  </tr>
                  {METRIC_CATEGORIES.map((category) => (
                    <tr key={category} className="border-t border-border">
                      <td className="py-2 pr-4 text-muted-foreground">{CATEGORY_LABELS[category]}</td>
                      {rows.map((r) => {
                        const score = r.ranking?.categoryScores.find((c) => c.category === category)?.score ?? null;
                        return (
                          <td key={r.ticker} className="py-2 pr-4">
                            <ScorePill score={score !== null ? score * 100 : null} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
