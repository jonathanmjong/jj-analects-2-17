import type { MetricCategory, MetricDefinition, MetricVerdict } from "@proverbs/shared";
import {
  CATEGORY_RATIONALE,
  defaultMetricWeight,
  DEFAULT_CATEGORY_WEIGHTS,
  getMetricRationale,
  GROWTH_HORIZON_NOTE,
  METRIC_CATEGORIES,
} from "@proverbs/shared";
import { useMetricDefinitions } from "../../hooks/useMetricDefinitions";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/Card";
import { Badge, type BadgeProps } from "../ui/Badge";
import { Spinner } from "../ui/Spinner";

const CATEGORY_LABELS: Record<MetricCategory, string> = {
  valuation: "Valuation",
  momentum: "Momentum",
  profitability: "Profitability",
  growth: "Growth",
  cashGeneration: "Cash Generation",
  financialStrength: "Financial Strength",
  capitalAllocation: "Capital Allocation",
  efficiency: "Efficiency",
  earningsQuality: "Earnings Quality",
  moat: "Competitive Moat",
};

const VERDICT_LABEL: Record<MetricVerdict, string> = {
  core: "Core value measure",
  supporting: "Supporting signal",
  caveat: "Use with caution",
  "not-value-investing": "Not value investing",
};

const VERDICT_VARIANT: Record<MetricVerdict, NonNullable<BadgeProps["variant"]>> = {
  core: "positive",
  supporting: "accent",
  caveat: "negative",
  "not-value-investing": "neutral",
};

function VerdictBadge({ verdict }: { verdict: MetricVerdict }) {
  return <Badge variant={VERDICT_VARIANT[verdict]}>{VERDICT_LABEL[verdict]}</Badge>;
}

/**
 * Admin-only reference: every metric in the ranking registry, grouped by category, with a plain
 * value-investing rationale for each — is this a sound way to identify undervalued, durable
 * businesses, or does it have known limitations (or, for momentum, does it not belong to the
 * philosophy at all)? Reads the live registry from Firestore (useMetricDefinitions, seeded by
 * the "Seed metric definitions" job above) rather than hardcoding the metric list here, so this
 * can never silently drift from what the ranking engine actually computes.
 */
export function ValueMetricsPanel() {
  const { data: metrics, isLoading, error } = useMetricDefinitions();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Value investing metrics reference</CardTitle>
      </CardHeader>
      <CardContent className="space-y-8 pt-2">
        <p className="text-sm text-muted-foreground">
          Every metric the ranking engine computes, with a note on whether it's a sound
          value-investing measure, a useful-but-limited supporting signal, or not part of the
          value-investing philosophy at all. Direction shows which raw values score better; a
          "negative ranks last" tag means the ranking engine treats any negative value as worse
          than every positive value, regardless of magnitude (a P/E of -50 is a worse company than
          a P/E of 50, not a cheaper one) — see shared/src/rankingEngineCore.ts.
        </p>

        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" /> Loading metric registry…
          </div>
        )}
        {error && <p className="text-sm text-negative">Failed to load metric definitions.</p>}

        {metrics && (
          <>
            {METRIC_CATEGORIES.map((category) => {
              const inCategory = metrics
                .filter((m: MetricDefinition) => m.category === category)
                .sort((a: MetricDefinition, b: MetricDefinition) => a.label.localeCompare(b.label));
              if (inCategory.length === 0) return null;
              const categoryInfo = CATEGORY_RATIONALE[category];
              const weight = DEFAULT_CATEGORY_WEIGHTS[category];

              return (
                <section key={category}>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold">{CATEGORY_LABELS[category]}</h3>
                    <Badge variant="neutral">{(weight * 100).toFixed(0)}% default weight</Badge>
                    <VerdictBadge verdict={categoryInfo.verdict} />
                  </div>
                  <p className="mb-3 text-sm text-muted-foreground">{categoryInfo.summary}</p>
                  {category === "growth" && <p className="mb-3 text-xs text-muted-foreground/80">{GROWTH_HORIZON_NOTE}</p>}

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase text-muted-foreground">
                          <th className="py-2 pr-4 font-medium">Metric</th>
                          <th className="py-2 pr-4 font-medium">Direction</th>
                          <th className="py-2 pr-4 font-medium">Verdict</th>
                          <th className="py-2 pr-4 font-medium">Why (or why not)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inCategory.map((metric: MetricDefinition) => {
                          const info = getMetricRationale(metric.key, metric.category);
                          return (
                            <tr key={metric.key} className="border-t border-border align-top">
                              <td className="py-2 pr-4 font-medium">{metric.label}</td>
                              <td className="py-2 pr-4 text-muted-foreground">
                                {metric.direction === "desc" ? "Higher is better" : "Lower is better"}
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {metric.negativeIsBad && <Badge variant="negative">negative ranks last</Badge>}
                                  {metric.sectorRelative && <Badge variant="accent">ranked within sector</Badge>}
                                  <Badge variant="neutral">{Math.round(defaultMetricWeight(metric) * 100)}% metric weight</Badge>
                                </div>
                              </td>
                              <td className="py-2 pr-4">
                                <VerdictBadge verdict={info.verdict} />
                              </td>
                              <td className="py-2 pr-4 text-muted-foreground">{info.rationale}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              );
            })}
          </>
        )}
      </CardContent>
    </Card>
  );
}
