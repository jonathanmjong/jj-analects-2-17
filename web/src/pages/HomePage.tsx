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
          <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="border-b border-border px-3 py-2 font-medium">Rank</th>
              <th className="border-b border-border px-3 py-2 font-medium">Company</th>
              <th className="border-b border-border px-3 py-2 font-medium">Sector</th>
              <th className="border-b border-border px-3 py-2 font-medium">Market Cap</th>
              <th className="border-b border-border px-3 py-2 font-medium">Score</th>
              <th className="border-b border-border px-3 py-2 font-medium">Trend</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  No ranked companies yet — run the seed/bootstrap job to populate data.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.ticker} className="border-b border-border last:border-b-0 hover:bg-surface-hover">
                <td className="px-3 py-2 text-muted-foreground">{row.overallRank ?? "—"}</td>
                <td className="px-3 py-2">
                  <Link to={`/company/${row.ticker}`} className="font-medium hover:text-accent">
                    {row.ticker}
                  </Link>
                  <div className="text-xs text-muted-foreground">{row.companyName}</div>
                </td>
                <td className="px-3 py-2">{row.sector ? <Badge variant="neutral">{row.sector}</Badge> : "—"}</td>
                <td className="px-3 py-2">{formatCurrency(row.latest?.marketCap ?? null, { compact: true })}</td>
                <td className="px-3 py-2">
                  <ScorePill score={row.overallScore} />
                </td>
                <td className="px-3 py-2 text-muted-foreground">
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
