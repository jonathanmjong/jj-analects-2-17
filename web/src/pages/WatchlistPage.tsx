import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useCompaniesList } from "../hooks/useCompanies";
import { useUserProfile } from "../hooks/useUserProfile";
import { Badge } from "../components/ui/Badge";
import { ScorePill } from "../components/ui/ScorePill";
import { WatchlistButton } from "../components/ui/WatchlistButton";
import { formatCurrency } from "../lib/utils";

export function WatchlistPage() {
  const navigate = useNavigate();
  const { watchlist, loading: profileLoading } = useUserProfile();
  const { data: companies, isLoading: companiesLoading } = useCompaniesList({ limitTo: 5000 });

  const rows = useMemo(() => {
    const watchedSet = new Set(watchlist);
    return (companies ?? [])
      .filter((c) => watchedSet.has(c.ticker))
      .sort((a, b) => (b.latest?.overallScore ?? -Infinity) - (a.latest?.overallScore ?? -Infinity));
  }, [companies, watchlist]);

  const isLoading = profileLoading || companiesLoading;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Watchlist</h1>
        <p className="text-muted-foreground">Companies you're tracking, ranked by overall score.</p>
      </div>

      <div className="overflow-hidden rounded-card border border-border">
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="border-b border-border px-3 py-2 font-medium">Rank</th>
              <th className="border-b border-border px-3 py-2 font-medium">Company</th>
              <th className="border-b border-border px-3 py-2 font-medium">Sector</th>
              <th className="border-b border-border px-3 py-2 font-medium">Market Cap</th>
              <th className="border-b border-border px-3 py-2 font-medium">Score</th>
              <th className="border-b border-border px-3 py-2 font-medium" />
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
                  No companies on your watchlist yet — click the star on any company row or page to add one.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr
                key={row.ticker}
                onClick={() => navigate(`/company/${row.ticker}`)}
                className="cursor-pointer border-b border-border last:border-b-0 hover:bg-surface-hover"
              >
                <td className="px-3 py-2 text-muted-foreground">{row.latest?.overallRank ?? "—"}</td>
                <td className="px-3 py-2">
                  <span className="font-medium">{row.ticker}</span>
                  <div className="text-xs text-muted-foreground">{row.companyName}</div>
                </td>
                <td className="px-3 py-2">{row.sector ? <Badge variant="neutral">{row.sector}</Badge> : "—"}</td>
                <td className="px-3 py-2">{formatCurrency(row.latest?.marketCap ?? null, { compact: true })}</td>
                <td className="px-3 py-2">
                  <ScorePill score={row.latest?.overallScore ?? null} />
                </td>
                <td className="px-3 py-2">
                  <WatchlistButton ticker={row.ticker} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
