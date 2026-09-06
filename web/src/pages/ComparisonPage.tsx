import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowRight, Check, Minus } from "lucide-react";
import { Button } from "../components/ui/Button";
import { MarketingHeader, MarketingFooter } from "../components/landing/MarketingChrome";
import { HeroPreviewMockup } from "../components/landing/Mockups";
import { useDocumentMeta } from "../hooks/useDocumentMeta";
import competitorsData from "../data/competitors.json";

interface ComparisonRow {
  feature: string;
  us: string;
  them: string;
}

interface CompetitorConfig {
  slug: string;
  name: string;
  intro: string;
  rows: ComparisonRow[];
}

const COMPETITORS: Record<string, CompetitorConfig> = competitorsData;

function ComparisonTable({ config }: { config: CompetitorConfig }) {
  return (
    <div className="overflow-x-auto rounded-card border border-border">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-muted">
            <th className="px-4 py-3 font-medium text-muted-foreground">Feature</th>
            <th className="px-4 py-3 font-semibold text-foreground">Analects 2.17</th>
            <th className="px-4 py-3 font-medium text-muted-foreground">{config.name}</th>
          </tr>
        </thead>
        <tbody>
          {config.rows.map((row) => (
            <tr key={row.feature} className="border-b border-border last:border-b-0">
              <td className="px-4 py-3 text-muted-foreground">{row.feature}</td>
              <td className="px-4 py-3 font-medium text-foreground">
                <span className="flex items-start gap-1.5">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-positive" />
                  {row.us}
                </span>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                <span className="flex items-start gap-1.5">
                  <Minus className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  {row.them}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ComparisonPage() {
  const { competitor = "" } = useParams<{ competitor: string }>();
  const config = COMPETITORS[competitor];

  useDocumentMeta(
    config ? `Analects 2.17 vs ${config.name} — Stock Screener Comparison` : "Analects 2.17",
    config
      ? `See how Analects 2.17 compares to ${config.name}: pricing, live weight sliders, cross-sectional scoring across ~70 fundamental metrics, and more.`
      : "Analects 2.17",
  );

  if (!config) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingHeader />

      <section className="mx-auto max-w-4xl px-4 pb-16 pt-16 text-center sm:px-6 sm:pt-24">
        <p className="text-sm font-medium text-accent">COMPARISON</p>
        <h1 className="mt-2 text-balance text-4xl font-bold tracking-tight sm:text-5xl">
          Analects 2.17 vs {config.name}
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-balance text-lg text-muted-foreground">{config.intro}</p>
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link to="/login">
            <Button size="lg" className="rounded-full px-7">
              Get started <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <span className="text-sm text-muted-foreground">7-day free trial · $2/month after · Cancel anytime</span>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-4 pb-20 sm:px-6">
        <ComparisonTable config={config} />
        <p className="mt-4 text-xs text-muted-foreground">
          Feature comparisons reflect our best understanding of publicly available information and may not capture
          the latest changes to third-party products — verify current details on {config.name}'s own site.
        </p>
      </section>

      <section className="mx-auto max-w-2xl px-4 pb-24 text-center sm:px-6">
        <HeroPreviewMockup />
      </section>

      <MarketingFooter />
    </div>
  );
}
