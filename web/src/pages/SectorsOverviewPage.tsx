import { useMemo } from "react";
import { Link } from "react-router-dom";
import { METRIC_CATEGORIES, SECTORS } from "@proverbs/shared";
import { useCompaniesList } from "../hooks/useCompanies";
import { useAllRankings } from "../hooks/useAllRankings";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";
import { ScorePill } from "../components/ui/ScorePill";
import { SectorTreemap } from "../components/charts/SectorTreemap";
import { ScoreHeatmap, type HeatmapCell } from "../components/charts/ScoreHeatmap";

const CATEGORY_LABELS: Record<string, string> = {
  valuation: "Valuation",
  profitability: "Profitability",
  growth: "Growth",
  cashGeneration: "Cash Gen.",
  financialStrength: "Fin. Strength",
  capitalAllocation: "Cap. Alloc.",
  efficiency: "Efficiency",
  earningsQuality: "Earn. Quality",
  moat: "Moat",
};

export function SectorsOverviewPage() {
  const { data: companies, isLoading } = useCompaniesList({ limitTo: 5000 });
  const { data: rankings } = useAllRankings();

  const bySector = SECTORS.map((sector) => {
    const members = (companies ?? []).filter((c) => c.sector === sector);
    const scores = members.map((c) => c.latest?.overallScore).filter((s): s is number => s !== null && s !== undefined);
    const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    const totalMarketCap = members.reduce((acc, c) => acc + (c.latest?.marketCap ?? 0), 0);
    return { sector, members, count: members.length, avgScore, totalMarketCap };
  });

  const treemapData = useMemo(
    () =>
      bySector
        .filter((s) => s.totalMarketCap > 0)
        .map((s) => ({ name: s.sector, size: s.totalMarketCap, avgScore: s.avgScore, count: s.count })),
    [bySector],
  );

  const heatmapCells = useMemo<HeatmapCell[]>(() => {
    if (!rankings) return [];
    const cells: HeatmapCell[] = [];
    for (const { sector, members } of bySector) {
      for (const category of METRIC_CATEGORIES) {
        const scores = members
          .map((m) => rankings.get(m.ticker)?.categoryScores.find((c) => c.category === category)?.score)
          .filter((s): s is number => s !== null && s !== undefined);
        const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length) * 100 : null;
        cells.push({ row: sector, column: CATEGORY_LABELS[category], value: avg });
      }
    }
    return cells;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankings, companies]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Sectors</h1>
        <p className="text-muted-foreground">Average score and company count within each GICS-style sector.</p>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Sector Size by Market Cap (colored by average score)</CardTitle>
            </CardHeader>
            <CardContent>
              <SectorTreemap data={treemapData} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sector × Category Average Score</CardTitle>
            </CardHeader>
            <CardContent>
              <ScoreHeatmap
                rows={SECTORS}
                columns={METRIC_CATEGORIES.map((c) => CATEGORY_LABELS[c])}
                cells={heatmapCells}
              />
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {bySector.map(({ sector, count, avgScore }) => (
              <Link key={sector} to={`/sectors/${encodeURIComponent(sector)}`}>
                <Card className="h-full transition-shadow hover:shadow-md">
                  <CardContent className="flex items-center justify-between pt-5">
                    <div>
                      <div className="font-medium">{sector}</div>
                      <div className="text-xs text-muted-foreground">{count} companies</div>
                    </div>
                    <ScorePill score={avgScore} />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
