import { useMemo } from "react";
import { computeNormalizedEarnings } from "@proverbs/shared";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/Card";
import { useValuationHistory } from "../../hooks/useValuationHistory";
import { formatCurrency } from "../../lib/utils";

/**
 * At most 2 significant figures, per the review panel's binding display rules
 * (FEATURE-RESEARCH.md §4.1). An average of up to ten annual filings, in
 * unadjusted dollars, does not carry a third digit.
 */
function mx(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 10) return `${value.toFixed(0)}x`;
  if (Math.abs(value) >= 1) return `${value.toFixed(1)}x`;
  return `${value.toFixed(2)}x`;
}

function pct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const asPercent = value * 100;
  return Math.abs(asPercent) >= 10 ? `${asPercent.toFixed(0)}%` : `${asPercent.toFixed(1)}%`;
}

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="text-lg font-medium tabular-nums">{value}</div>
      {note !== undefined && <div className="text-xs text-muted-foreground">{note}</div>}
    </div>
  );
}

/**
 * Describes where the latest year sits against the company's own multi-year
 * average, in conditions rather than verdicts — "above its own average" is a
 * fact about the earnings series; "peak-cycle trap" would be a judgement the
 * number cannot support on its own.
 */
function aboveOrBelow(ratio: number, years: number): string {
  const rounded = Math.abs(ratio) >= 10 ? ratio.toFixed(0) : ratio.toFixed(1);
  if (ratio < 0) {
    return `The latest year was a loss, while the ${years}-year average is a profit — a trailing earnings multiple has no meaning for this year, and the average is the only earnings figure here that does.`;
  }
  if (ratio >= 1.05) {
    return `The latest year earned ${rounded}x this ${years}-year average, so today's trailing multiple is measured against earnings above the company's own recent norm.`;
  }
  if (ratio <= 0.95) {
    return `The latest year earned ${rounded}x this ${years}-year average, so today's trailing multiple is measured against earnings below the company's own recent norm.`;
  }
  return `The latest year earned ${rounded}x this ${years}-year average — close to it, so the trailing multiple and this one describe much the same denominator.`;
}

export function NormalizedEarningsPanel({
  ticker,
  sector,
  todayMarketCap,
  priceSource,
}: {
  ticker: string;
  sector: string | null;
  todayMarketCap: number | null;
  /** When the price ingestion fell back to EDGAR's public float, the "market cap" excludes affiliate-held shares — disclosed inline rather than silently used. */
  priceSource?: "live" | "sec_public_float";
}) {
  const { data, isPending, isError } = useValuationHistory(ticker);

  const report = useMemo(
    () =>
      computeNormalizedEarnings(data?.entries ?? [], {
        currentMarketCap: todayMarketCap,
        sector,
        currentMarketCapIsPublicFloat: priceSource === "sec_public_float",
      }),
    [data, todayMarketCap, sector, priceSource],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Earnings Across the Cycle</CardTitle>
      </CardHeader>

      <CardContent className="space-y-4 pt-2">
        {isPending ? (
          <p className="text-sm text-muted-foreground">Reading this company's filing history…</p>
        ) : isError ? (
          <p className="text-sm text-muted-foreground">
            This company's multi-year earnings history could not be loaded, so nothing is shown here rather than a
            partial picture.
          </p>
        ) : report.status !== "ok" ? (
          // Rendered as a stated reason, never hidden: a missing panel is
          // indistinguishable from a panel that had nothing to say.
          <p className="text-sm text-muted-foreground">
            {report.status === "not-applicable"
              ? "An average of reported earnings is not shown for this company because "
              : "No multi-year earnings average is shown because "}
            {report.reason}.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Averaging reported net income over {report.window!.years} fiscal years, so the multiple below is measured
              against what this business has earned through a cycle rather than against its most recent twelve months.
            </p>

            <div className="grid grid-cols-2 gap-4">
              <Figure
                label="Average annual earnings"
                value={formatCurrency(report.normalizedEarnings, { compact: true })}
                note={report.window!.label}
              />
              <Figure
                label="Price / average earnings"
                value={mx(report.capeRatio)}
                note={report.capeRatio === null ? undefined : "market value ÷ the average at left"}
              />
              <Figure
                label={`Latest year (FY${report.latestFiscalYear})`}
                value={formatCurrency(report.latestEarnings, { compact: true })}
                note={report.earningsVsNormalized === null ? undefined : `${mx(report.earningsVsNormalized)} the average`}
              />
              <Figure
                label="Net margin"
                value={pct(report.latestMargin)}
                note={
                  report.normalizedMargin === null
                    ? "latest year; no mid-cycle average available"
                    : `latest year, against ${pct(report.normalizedMargin)} averaged over ${report.normalizedMarginYears} years`
                }
              />
            </div>

            {report.earningsVsNormalized !== null && (
              <p className="text-sm">{aboveOrBelow(report.earningsVsNormalized, report.window!.years)}</p>
            )}

            <div className="space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
              <p>{report.basisNote}</p>
              {report.capeReason !== null && <p>No multiple is shown because {report.capeReason}.</p>}
              {report.earningsVsNormalizedReason !== null && (
                <p>The latest year is not compared with the average because {report.earningsVsNormalizedReason}.</p>
              )}
              {report.marginReason !== null && <p>No mid-cycle margin is shown because {report.marginReason}.</p>}
              {report.caveats.map((caveat) => (
                <p key={caveat}>{caveat}</p>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
