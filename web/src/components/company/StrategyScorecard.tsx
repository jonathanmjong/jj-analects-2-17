import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { evaluateAllStrategies, STRATEGY_BY_KEY, type StrategyRuleResult } from "@proverbs/shared";
import { Badge } from "../ui/Badge";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/Card";
import { formatCurrency, formatMultiple, formatNumber, formatPercent } from "../../lib/utils";

interface StrategyScorecardProps {
  /**
   * Raw metric values keyed by registry metric key (`roic`, `pe_ttm`, …) plus
   * `market_cap` (MARKET_CAP_INPUT_KEY). Missing keys and nulls both read as
   * "no data" and drop the rule out of its chain's denominator.
   */
  metricValues: Record<string, number | null>;
}

function formatActual(result: StrategyRuleResult): string {
  if (result.actual === null) return "—";
  switch (result.unit) {
    case "percent":
      return formatPercent(result.actual);
    case "currency":
      return formatCurrency(result.actual, { compact: true });
    case "multiple":
    case "ratio":
      return formatMultiple(result.actual);
    case "score":
      return formatNumber(result.actual, 0);
  }
}

export function StrategyScorecard({ metricValues }: StrategyScorecardProps) {
  const evaluations = useMemo(() => evaluateAllStrategies(metricValues), [metricValues]);
  const [expanded, setExpanded] = useState<string | null>(evaluations[0]?.key ?? null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Strategy Screens</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 pt-2">
        <p className="pb-1 text-xs text-muted-foreground">
          Rule chains drawn from the published value literature, run against this company's latest figures. Each is
          reported as the rules it passes — there is no score, no grade, and nothing combined across strategies.
          Rules we have no data for are shown as such and left out of the count.
        </p>

        {evaluations.map((evaluation) => {
          const definition = STRATEGY_BY_KEY[evaluation.key];
          const required = definition.minRulesToQualify ?? definition.rules.length;
          const isOpen = expanded === evaluation.key;
          return (
            <div key={evaluation.key} className="border-t border-border py-2 first:border-t-0">
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : evaluation.key)}
                className="flex w-full items-center justify-between gap-3 rounded-md px-1 py-1 text-left hover:bg-surface-hover"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                  <span className="truncate text-sm text-foreground">{definition.name}</span>
                  {evaluation.qualifies === true && (
                    <Badge variant="positive">{required < definition.rules.length ? `meets ${required} of ${definition.rules.length}` : "meets every rule"}</Badge>
                  )}
                  {evaluation.qualifies === null && <Badge variant="neutral">incomplete data</Badge>}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {evaluation.total === 0
                    ? "no data"
                    : `passes ${evaluation.passed} of ${evaluation.total} rule${evaluation.total === 1 ? "" : "s"}`}
                  {evaluation.notComputable > 0 && evaluation.total > 0 && ` · ${evaluation.notComputable} no data`}
                </span>
              </button>

              {isOpen && (
                <div className="mt-1.5 space-y-2 px-1">
                  <p className="text-xs text-muted-foreground">{definition.description}</p>
                  <table className="w-full text-xs">
                    <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="py-1 pr-3 font-medium">Rule</th>
                        <th className="py-1 pr-3 font-medium">Threshold</th>
                        <th className="py-1 pr-3 font-medium">Actual</th>
                        <th className="py-1 font-medium">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {evaluation.results.map((result) => (
                        <tr key={result.label} className="border-t border-border">
                          <td className="py-1 pr-3 text-foreground/90">{result.label}</td>
                          <td className="whitespace-nowrap py-1 pr-3 font-mono text-muted-foreground">{result.threshold}</td>
                          <td className="whitespace-nowrap py-1 pr-3 font-mono text-foreground/90">{formatActual(result)}</td>
                          <td className="whitespace-nowrap py-1">
                            {result.pass === null ? (
                              <span className="text-muted-foreground">no data</span>
                            ) : result.pass ? (
                              <span className="text-positive">pass</span>
                            ) : (
                              <span className="text-negative">fail</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-[11px] text-muted-foreground">
                    <span className="text-foreground/70">{definition.source.name}</span> · published{" "}
                    {definition.source.published}. Tested on: {definition.source.testedUniverse}.
                  </p>
                  {definition.source.caveat && (
                    <p className="text-[11px] text-muted-foreground">{definition.source.caveat}</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
