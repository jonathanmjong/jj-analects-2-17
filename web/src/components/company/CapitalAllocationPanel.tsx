import { useMemo } from "react";
import type {
  BalanceSheet,
  CapitalAllocationTrend,
  CashFlowStatement,
  IncomeStatement,
} from "@proverbs/shared";
import { computeCapitalAllocation } from "@proverbs/shared";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/Card";
import { cn } from "../../lib/utils";

/**
 * The glyph carries the reading, not the raw direction of the number — falling
 * net debt and a falling share count both point up here. The word is rendered
 * beside it so the arrow can't be misread as "this figure rose".
 */
const TREND: Record<CapitalAllocationTrend, { glyph: string; label: string; className: string }> = {
  improving: { glyph: "▲", label: "improving", className: "text-positive" },
  deteriorating: { glyph: "▼", label: "deteriorating", className: "text-negative" },
  flat: { glyph: "–", label: "little changed", className: "text-muted-foreground" },
};

export function CapitalAllocationPanel({
  income,
  balance,
  cashFlow,
  sector,
}: {
  income: IncomeStatement[];
  balance: BalanceSheet[];
  cashFlow: CashFlowStatement[];
  sector: string | null;
}) {
  const report = useMemo(
    () => computeCapitalAllocation({ income, balance, cashFlow, sector }),
    [income, balance, cashFlow, sector],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Capital Allocation</CardTitle>
      </CardHeader>

      <CardContent className="space-y-4 pt-2">
        <p className="text-base">{report.summary}</p>

        <div className="space-y-4">
          {report.pillars.map((pillar) => (
            <section key={pillar.key} className="border-t border-border pt-3">
              <h4 className="text-xs uppercase text-muted-foreground">{pillar.title}</h4>

              {pillar.suppressed ? (
                <p className="mt-1 text-sm text-muted-foreground">{pillar.suppressed}</p>
              ) : (
                <>
                  <p className="mt-1 text-sm">{pillar.reading}</p>
                  {pillar.points.length > 0 && (
                    <ul className="mt-2 space-y-1.5">
                      {pillar.points.map((point) => (
                        <li
                          key={point.label}
                          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-sm"
                        >
                          <span className="text-muted-foreground">{point.label}</span>
                          <span className="flex items-baseline gap-1.5">
                            <span>{point.value}</span>
                            {point.trend && (
                              <span className={cn("text-xs", TREND[point.trend].className)}>
                                {TREND[point.trend].glyph} {TREND[point.trend].label}
                              </span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </section>
          ))}
        </div>

        <p className="border-t border-border pt-3 text-xs text-muted-foreground">
          Read off up to five fiscal years of annual statements, described rather than graded. No EBITDA line is
          reported by this data source, so leverage is expressed against operating income; after-tax operating profit
          uses the filings' own effective tax rate, or a 24% convention where those lines are unusable. Whether
          buybacks were made at high or low points in the company's own valuation history is not shown — that test
          needs a multi-year price history this app does not yet ingest.
        </p>
      </CardContent>
    </Card>
  );
}
