import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useCompaniesList } from "../hooks/useCompanies";
import { useCustomRankings } from "../hooks/useCustomRankings";
import { Card, CardContent } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { ScorePill } from "../components/ui/ScorePill";
import { Slider } from "../components/ui/Slider";
import { formatCurrency } from "../lib/utils";

export function HomePage() {
  const { data: companies, isLoading } = useCompaniesList({ limitTo: 100 });
  const { results, loading: recomputing, setYearsIncluded, recompute } = useCustomRankings();
  const [years, setYears] = useState(5);

  const overrideByTicker = useMemo(() => {
    if (!results) return null;
    return new Map(results.map((r) => [r.ticker, r]));
  }, [results]);

  function handleYearsChange(value: number) {
    setYears(value);
    const nextConfig = setYearsIncluded(value as 1 | 2 | 3 | 4 | 5);
    void recompute(nextConfig);
  }

  const rows = (companies ?? [])
    .map((c) => {
      const override = overrideByTicker?.get(c.ticker);
      return {
        ...c,
        overallScore: override ? override.overallScore : c.latest?.overallScore ?? null,
        overallRank: override ? override.overallRank : c.latest?.overallRank ?? null,
      };
    })
    .sort((a, b) => (b.overallScore ?? -Infinity) - (a.overallScore ?? -Infinity))
    .slice(0, 100);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Top 100 Companies</h1>
        <p className="text-muted-foreground">
          Ranked by a multi-factor model spanning valuation, profitability, growth, financial strength, capital
          allocation, and earnings quality.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex-1">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Years of history included in overall rank</span>
              <span className="text-muted-foreground">
                {years} year{years > 1 ? "s" : ""} {recomputing && "· recomputing…"}
              </span>
            </div>
            <Slider
              min={1}
              max={5}
              step={1}
              value={years}
              onChange={(e) => handleYearsChange(Number(e.target.value))}
              className="mt-2"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Default weighting across years: 35% / 25% / 20% / 10% / 10% (most recent first). Missing years are
              excluded and remaining weights renormalized.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="overflow-hidden rounded-card border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Rank</th>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Sector</th>
              <th className="px-4 py-3">Market Cap</th>
              <th className="px-4 py-3">Score</th>
              <th className="px-4 py-3">Trend</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No ranked companies yet — run the seed/bootstrap job to populate data.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.ticker} className="border-t border-border hover:bg-surface-muted/60">
                <td className="px-4 py-3 text-muted-foreground">{row.overallRank ?? "—"}</td>
                <td className="px-4 py-3">
                  <Link to={`/company/${row.ticker}`} className="font-medium hover:text-accent">
                    {row.ticker}
                  </Link>
                  <div className="text-xs text-muted-foreground">{row.companyName}</div>
                </td>
                <td className="px-4 py-3">{row.sector ? <Badge variant="neutral">{row.sector}</Badge> : "—"}</td>
                <td className="px-4 py-3">{formatCurrency(row.latest?.marketCap ?? null, { compact: true })}</td>
                <td className="px-4 py-3">
                  <ScorePill score={row.overallScore} />
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {row.overallRank && row.overallRank <= 10 ? "Top 10" : row.isSp500 ? "S&P 500" : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
