import { Link, useParams } from "react-router-dom";
import type { Sector } from "@proverbs/shared";
import { useCompaniesList } from "../hooks/useCompanies";
import { ScorePill } from "../components/ui/ScorePill";
import { Badge } from "../components/ui/Badge";
import { formatCurrency } from "../lib/utils";

export function SectorDetailPage() {
  const { sector } = useParams<{ sector: string }>();
  const { data: companies, isLoading } = useCompaniesList({ sector: sector as Sector, limitTo: 500 });

  const ranked = (companies ?? []).slice().sort(
    (a, b) => (b.latest?.overallScore ?? -Infinity) - (a.latest?.overallScore ?? -Infinity),
  );

  return (
    <div className="space-y-6">
      <div>
        <Link to="/sectors" className="text-sm text-muted-foreground hover:text-foreground">
          ← All sectors
        </Link>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{sector}</h1>
        <p className="text-muted-foreground">{ranked.length} companies ranked within this sector.</p>
      </div>

      <div className="overflow-hidden rounded-card border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Rank in sector</th>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Industry</th>
              <th className="px-4 py-3">Market Cap</th>
              <th className="px-4 py-3">Score</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
            {ranked.map((c, idx) => (
              <tr key={c.ticker} className="border-t border-border hover:bg-surface-muted/60">
                <td className="px-4 py-3 text-muted-foreground">{idx + 1}</td>
                <td className="px-4 py-3">
                  <Link to={`/company/${c.ticker}`} className="font-medium hover:text-accent">
                    {c.ticker}
                  </Link>
                  <div className="text-xs text-muted-foreground">{c.companyName}</div>
                </td>
                <td className="px-4 py-3">{c.industry ?? "—"}</td>
                <td className="px-4 py-3">{formatCurrency(c.latest?.marketCap ?? null, { compact: true })}</td>
                <td className="px-4 py-3">
                  <ScorePill score={c.latest?.overallScore ?? null} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!isLoading && ranked.length === 0 && <Badge variant="neutral">No companies ingested for this sector yet.</Badge>}
    </div>
  );
}
