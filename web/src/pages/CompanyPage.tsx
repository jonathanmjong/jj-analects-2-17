import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { METRIC_CATEGORIES, type MetricDefinition } from "@proverbs/shared";
import { useCompanyDetail } from "../hooks/useCompanyDetail";
import { useCompaniesList } from "../hooks/useCompanies";
import { useCustomRankings } from "../hooks/useCustomRankings";
import { useMetricDefinitions } from "../hooks/useMetricDefinitions";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { ScorePill } from "../components/ui/ScorePill";
import { Slider } from "../components/ui/Slider";
import { SpiderChart } from "../components/charts/SpiderChart";
import { HistoryLineChart } from "../components/charts/HistoryLineChart";
import { formatCurrency, formatNumber, formatPercent } from "../lib/utils";

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

export function CompanyPage() {
  const { ticker = "" } = useParams<{ ticker: string }>();
  const { data, isLoading } = useCompanyDetail(ticker);
  const { data: peers } = useCompaniesList({ sector: data?.company.sector ?? undefined, limitTo: 500 });
  const { results, loading: recomputing, setYearsIncluded, recompute } = useCustomRankings();
  const { data: metricDefinitions } = useMetricDefinitions();
  const [years, setYears] = useState(5);

  const metricsByCategory = useMemo(() => {
    const map: Record<string, MetricDefinition[]> = {};
    for (const def of metricDefinitions ?? []) {
      (map[def.category] ??= []).push(def);
    }
    return map;
  }, [metricDefinitions]);

  const override = results?.find((r) => r.ticker === ticker.toUpperCase());
  const ranking = override ?? data?.ranking ?? null;

  function handleYearsChange(value: number) {
    setYears(value);
    const nextConfig = setYearsIncluded(value as 1 | 2 | 3 | 4 | 5);
    void recompute(nextConfig);
  }

  const revenueHistory = useMemo(
    () =>
      (data?.income ?? [])
        .slice()
        .reverse()
        .map((s) => ({ periodKey: s.periodKey, value: s.revenue ?? 0 })),
    [data],
  );
  const fcfHistory = useMemo(
    () =>
      (data?.cashFlow ?? [])
        .slice()
        .reverse()
        .map((s) => ({ periodKey: s.periodKey, value: s.freeCashFlow ?? 0 })),
    [data],
  );
  const marginHistory = useMemo(
    () =>
      (data?.income ?? [])
        .slice()
        .reverse()
        .map((s) => ({
          periodKey: s.periodKey,
          value: s.revenue ? (s.grossProfit ?? 0) / s.revenue : 0,
        })),
    [data],
  );

  const sectorAvgScore = useMemo(() => {
    const scores = (peers ?? [])
      .filter((p) => p.ticker !== ticker.toUpperCase())
      .map((p) => p.latest?.overallScore)
      .filter((s): s is number => s !== null && s !== undefined);
    return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  }, [peers, ticker]);

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (!data) return <p className="text-muted-foreground">No data for {ticker} yet.</p>;

  const { company } = data;
  const latestMetricPeriod = data.metricScoresByPeriod[0];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">{company.ticker}</h1>
            {company.sector && <Badge variant="neutral">{company.sector}</Badge>}
            {company.isSp500 && <Badge variant="accent">S&P 500</Badge>}
          </div>
          <p className="text-muted-foreground">{company.companyName}</p>
        </div>
        <div className="flex items-center gap-6 text-right">
          <div>
            <div className="text-xs uppercase text-muted-foreground">Price</div>
            <div className="text-lg font-medium">{formatCurrency(company.latest?.sharePrice ?? null)}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-muted-foreground">Market Cap</div>
            <div className="text-lg font-medium">{formatCurrency(company.latest?.marketCap ?? null, { compact: true })}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-muted-foreground">Overall Score</div>
            <ScorePill score={ranking?.overallScore ?? null} className="mt-1" />
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="pt-5">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Years of history included in overall rank</span>
            <span className="text-muted-foreground">
              {years} year{years > 1 ? "s" : ""} {recomputing && "· recomputing…"}
            </span>
          </div>
          <Slider min={1} max={5} step={1} value={years} onChange={(e) => handleYearsChange(Number(e.target.value))} className="mt-2" />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Category Scores</CardTitle>
          </CardHeader>
          <CardContent>
            <SpiderChart
              categories={METRIC_CATEGORIES.map((c) => CATEGORY_LABELS[c])}
              series={[
                {
                  name: company.ticker,
                  color: "var(--color-accent)",
                  values: Object.fromEntries(
                    (ranking?.categoryScores ?? []).map((c) => [CATEGORY_LABELS[c.category], (c.score ?? 0) * 100]),
                  ),
                },
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Peer / Sector Comparison</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <span className="text-sm">{company.ticker} overall score</span>
              <ScorePill score={ranking?.overallScore ?? null} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">{company.sector ?? "Sector"} average</span>
              <ScorePill score={sectorAvgScore} />
            </div>
            <p className="text-xs text-muted-foreground">
              Based on {peers?.length ?? 0} companies currently ingested in this sector.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Revenue History</CardTitle>
          </CardHeader>
          <CardContent>
            <HistoryLineChart data={revenueHistory} label="Revenue" formatValue={(v) => formatCurrency(v, { compact: true })} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Free Cash Flow History</CardTitle>
          </CardHeader>
          <CardContent>
            <HistoryLineChart data={fcfHistory} label="FCF" formatValue={(v) => formatCurrency(v, { compact: true })} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Gross Margin History</CardTitle>
          </CardHeader>
          <CardContent>
            <HistoryLineChart data={marginHistory} label="Gross Margin" formatValue={(v) => formatPercent(v)} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Metric Breakdown (most recent fiscal year)</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {METRIC_CATEGORIES.map((category) => (
            <div key={category} className="mb-6">
              <h3 className="mb-2 text-sm font-semibold">{CATEGORY_LABELS[category]}</h3>
              <table className="w-full text-sm">
                <tbody>
                  {metricsByCategory[category]?.map((metric) => {
                    const score = latestMetricPeriod?.scores?.[metric.key];
                    const missing = !score || score.isMissing;
                    return (
                      <tr key={metric.key} className="border-t border-border">
                        <td className="py-2 pr-4 text-muted-foreground">{metric.label}</td>
                        <td className="py-2 text-right">
                          {missing ? (
                            <span className="text-xs text-muted-foreground">Data missing — excluded from weighting</span>
                          ) : metric.unit === "percent" ? (
                            formatPercent(score.rawValue)
                          ) : (
                            formatNumber(score.rawValue, 2)
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
