import { useMemo } from "react";
import { Link } from "react-router-dom";
import { SECTORS } from "@proverbs/shared";
import { useCompaniesList } from "../hooks/useCompanies";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";
import { ScorePill } from "../components/ui/ScorePill";
import { SectorTreemap } from "../components/charts/SectorTreemap";

export function SectorsOverviewPage() {
  const { data: companies, isLoading } = useCompaniesList({ limitTo: 5000 });

  const bySector = SECTORS.map((sector) => {
    const members = (companies ?? []).filter((c) => c.sector === sector);
    const scores = members.map((c) => c.latest?.overallScore).filter((s): s is number => s !== null && s !== undefined);
    const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    const totalMarketCap = members.reduce((acc, c) => acc + (c.latest?.marketCap ?? 0), 0);
    return { sector, count: members.length, avgScore, totalMarketCap };
  });

  const treemapData = useMemo(
    () =>
      bySector
        .filter((s) => s.totalMarketCap > 0)
        .map((s) => ({ name: s.sector, size: s.totalMarketCap, avgScore: s.avgScore, count: s.count })),
    [bySector],
  );

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
