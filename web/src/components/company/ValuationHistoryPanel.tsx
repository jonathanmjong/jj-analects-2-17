import { useMemo } from "react";
import type { BalanceSheet, IncomeStatement, MultipleDistribution } from "@proverbs/shared";
import { computeOwnHistoryValuation, todayFundamentalsFromStatements } from "@proverbs/shared";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/Card";
import { useValuationHistory } from "../../hooks/useValuationHistory";

/**
 * At most 2 significant figures. A multiple built from a mid-year float and an
 * annual filing does not carry a third digit, and printing one would claim a
 * precision the inputs cannot support.
 */
function mx(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (value >= 10) return `${value.toFixed(0)}x`;
  if (value >= 1) return `${value.toFixed(1)}x`;
  return `${value.toFixed(2)}x`;
}

function ordinal(value: number): string {
  const n = Math.round(value);
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * Median, interquartile box and full range — not a mean with a symmetric band.
 * Multiples are bounded below by zero and unbounded above, so one re-rating
 * year would drag a mean somewhere no year ever was.
 */
function DistributionBand({ multiple }: { multiple: MultipleDistribution }) {
  const summary = multiple.summary;
  if (summary === null) return null;
  const today = multiple.todayFloatBasisValue;

  const lo = Math.min(summary.min, today ?? summary.min);
  const hi = Math.max(summary.max, today ?? summary.max);
  const span = hi - lo || 1;
  const pad = span * 0.08;
  const domainLo = lo - pad;
  const domainSpan = hi + pad - domainLo;
  const at = (value: number) => ((value - domainLo) / domainSpan) * 100;

  return (
    <div className="mt-3">
      <div className="relative h-7">
        <div
          className="absolute top-1/2 h-px -translate-y-1/2 bg-border"
          style={{ left: `${at(summary.min)}%`, width: `${at(summary.max) - at(summary.min)}%` }}
        />
        <div
          className="absolute top-1/2 h-4 -translate-y-1/2 rounded-sm bg-accent/20"
          style={{ left: `${at(summary.q1)}%`, width: `${Math.max(at(summary.q3) - at(summary.q1), 0.4)}%` }}
        />
        <div
          className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-border"
          style={{ left: `${at(summary.min)}%` }}
        />
        <div
          className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-border"
          style={{ left: `${at(summary.max)}%` }}
        />
        <div
          className="absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-muted-foreground"
          style={{ left: `${at(summary.median)}%` }}
          title={`Median ${mx(summary.median)}`}
        />
        {today !== null && (
          <div
            className="absolute top-0 h-7 w-0.5 -translate-x-1/2 bg-accent"
            style={{ left: `${at(today)}%` }}
            title={`Today ${mx(today)}`}
          />
        )}
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>{mx(summary.min)} low</span>
        <span>median {mx(summary.median)}</span>
        <span>{mx(summary.max)} high</span>
      </div>
    </div>
  );
}

function MultipleRow({ multiple, windowYears }: { multiple: MultipleDistribution; windowYears: number | null }) {
  const summary = multiple.summary;

  return (
    <li className="border-t border-border pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-sm font-medium">{multiple.label}</span>
        <span className="text-[11px] text-muted-foreground">{multiple.formula}</span>
      </div>

      {summary === null ? (
        <p className="mt-1 text-sm text-muted-foreground">
          {multiple.suppressed ? "Withheld — " : "Not shown — "}
          {multiple.reason}
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted-foreground">
            Median {mx(summary.median)}; the middle half of its {summary.n} usable years sits between {mx(summary.q1)}{" "}
            and {mx(summary.q3)}.
          </p>
          <DistributionBand multiple={multiple} />
          {multiple.todayPercentile !== null && multiple.todayFloatBasisValue !== null ? (
            <p className="mt-2 text-sm">
              Today {mx(multiple.todayFloatBasisValue)} on the same float basis —{" "}
              <span className="font-medium">
                {ordinal(multiple.todayPercentile)} percentile of its own {windowYears ?? summary.n}-year history
              </span>
              .
            </p>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              Today, on the ordinary market-cap basis: {mx(multiple.todayMarketCapBasisValue)}. That is a different
              basis from the band above — a market cap counts every share, this history counts only the non-affiliate
              float — so it is not placed on it.
            </p>
          )}
        </>
      )}
    </li>
  );
}

export function ValuationHistoryPanel({
  ticker,
  sector,
  todayMarketCap,
  income,
  balance,
  priceSource,
}: {
  ticker: string;
  sector: string | null;
  todayMarketCap: number | null;
  income: IncomeStatement[];
  balance: BalanceSheet[];
  /**
   * Passed through from LatestSnapshot when available: when the price ingestion
   * fell back to EDGAR's public float, today's "market cap" is already on the
   * float basis and must not be scaled onto it a second time.
   */
  priceSource?: "live" | "sec_public_float";
}) {
  const { data, isPending, isError } = useValuationHistory(ticker);

  const report = useMemo(
    () =>
      computeOwnHistoryValuation({
        entries: data?.entries ?? [],
        todayMarketCap,
        todayFundamentals: todayFundamentalsFromStatements(income, balance),
        sector,
        anchors: data?.anchors ?? [],
        todayMarketCapIsPublicFloat: priceSource === "sec_public_float",
      }),
    [data, todayMarketCap, income, balance, sector, priceSource],
  );

  const { assumptions, discontinuities } = report;
  const windowYears = assumptions.fiscalYears.length > 0 ? assumptions.fiscalYears.length : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Valuation vs Its Own History</CardTitle>
      </CardHeader>

      <CardContent className="space-y-4 pt-2">
        {isPending ? (
          <p className="text-sm text-muted-foreground">Reading this company's filing history…</p>
        ) : isError ? (
          <p className="text-sm text-muted-foreground">
            This company's public-float history could not be loaded, so nothing is shown here rather than a partial
            picture.
          </p>
        ) : (
          <>
            {report.reason !== null && (
              <p className="text-sm text-muted-foreground">
                {report.status === "insufficient"
                  ? "No own-history comparison is shown"
                  : "Today's valuation is not placed on these bands"}{" "}
                because {report.reason}.
                {report.status === "not-comparable" && " The history below is still shown as context."}
              </p>
            )}

            {assumptions.fiscalYears.length > 0 && (
              <ul className="space-y-3">
                {report.multiples.map((multiple) => (
                  <MultipleRow key={multiple.key} multiple={multiple} windowYears={windowYears} />
                ))}
              </ul>
            )}

            {discontinuities.length > 0 && (
              <div className="border-t border-border pt-3">
                <h4 className="text-xs uppercase text-muted-foreground">Continuity breaks in this window</h4>
                <ul className="mt-1 space-y-1">
                  {discontinuities.map((flag) => (
                    <li key={flag.fiscalYear} className="text-xs text-muted-foreground">
                      {flag.note}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
              <p>{assumptions.basis}</p>
              <p>
                Window: {assumptions.window ?? "no fiscal years on file"}
                {assumptions.todayFundamentalsFiscalYear !== null &&
                  `; today's multiples use FY${assumptions.todayFundamentalsFiscalYear} annual figures against today's market value`}
                .
              </p>
              <p>{assumptions.normalization}</p>
              {assumptions.percentileResolution !== null && <p>{assumptions.percentileResolution}</p>}
              {assumptions.suppressedMultiples.length > 0 && (
                <p>
                  Withheld:{" "}
                  {assumptions.suppressedMultiples.map((s, i) => (
                    <span key={s.key}>
                      {i > 0 && "; "}
                      {s.reason}
                    </span>
                  ))}
                </p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
