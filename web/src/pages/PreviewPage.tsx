import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { loadFirestore } from "../lib/firebase";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { ScorePill } from "../components/ui/ScorePill";
import { MarketingHeader, MarketingFooter } from "../components/landing/MarketingChrome";
import { useDocumentMeta } from "../hooks/useDocumentMeta";

interface PreviewCompany {
  ticker: string;
  companyName: string;
  sector: string | null;
  overallScore: number | null;
  overallRank: number | null;
}

export function PreviewPage() {
  const [companies, setCompanies] = useState<PreviewCompany[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useDocumentMeta(
    "Top 20 Ranked Stocks (Free Preview) | Analects 2.17",
    "See the current top 20 highest-scoring stocks from Analects 2.17's multi-factor ranking model — no signup required. Full universe and live weight sliders require an account.",
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [{ doc, getDoc }, db] = await Promise.all([import("../lib/firestore"), loadFirestore()]);
        const snap = await getDoc(doc(db, "rankings", "preview"));
        if (cancelled) return;
        const data = snap.data();
        setCompanies((data?.companies as PreviewCompany[] | undefined) ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load preview.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingHeader />

      <section className="mx-auto max-w-3xl px-4 pb-10 pt-16 text-center sm:px-6 sm:pt-24">
        <p className="text-sm font-medium text-accent">FREE PREVIEW</p>
        <h1 className="mt-2 text-balance text-4xl font-bold tracking-tight sm:text-5xl">
          Today's top 20, no signup required.
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-balance text-lg text-muted-foreground">
          A live look at the highest-scoring companies in the full ranked universe. Sign up to see all ~1,300+
          companies, every metric behind the score, and reweight the model yourself.
        </p>
      </section>

      <section className="mx-auto max-w-2xl px-4 pb-16 sm:px-6">
        <div className="overflow-hidden rounded-card border border-border bg-surface shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-5 py-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <span>Company</span>
            <span>Score</span>
          </div>
          {error && <p className="px-5 py-8 text-center text-sm text-negative">{error}</p>}
          {!error && companies === null && <p className="px-5 py-8 text-center text-sm text-muted-foreground">Loading…</p>}
          {!error && companies?.length === 0 && (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">Preview not available right now.</p>
          )}
          {companies?.map((c, i) => (
            <div key={c.ticker} className={`flex items-center justify-between px-5 py-3 ${i !== companies.length - 1 ? "border-b border-border" : ""}`}>
              <div className="flex items-center gap-3">
                <span className="w-5 text-sm text-muted-foreground">{c.overallRank}</span>
                <div className="text-left">
                  <div className="text-sm font-medium">{c.ticker}</div>
                  <div className="text-xs text-muted-foreground">{c.companyName}</div>
                </div>
                {c.sector && (
                  <Badge variant="neutral" className="ml-1">
                    {c.sector}
                  </Badge>
                )}
              </div>
              <ScorePill score={c.overallScore} />
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-col items-center gap-3">
          <Link to="/login">
            <Button size="lg" className="rounded-full px-7">
              See the full ranked universe <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <span className="text-sm text-muted-foreground">7-day free trial · $2/month after · Cancel anytime</span>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
