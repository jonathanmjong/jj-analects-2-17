import { useMemo } from "react";
import {
  CartesianGrid,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BalanceSheet, IncomeStatement } from "@proverbs/shared";
import { computeGrowthRoicSeries, INDICATIVE_COST_OF_CAPITAL, MIN_INVESTED_CAPITAL_SHARE_OF_ASSETS } from "@proverbs/shared";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/Card";
import { formatPercent } from "../../lib/utils";

interface PlotPoint {
  fiscalYear: number;
  revenueGrowth: number;
  roic: number;
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: PlotPoint }> }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-sm">
      <div className="font-semibold">FY{point.fiscalYear}</div>
      <div className="mt-1">Revenue growth: {formatPercent(point.revenueGrowth)}</div>
      <div>Return on invested capital: {formatPercent(point.roic)}</div>
    </div>
  );
}

export function GrowthRoicChart({ income, balance }: { income: IncomeStatement[]; balance: BalanceSheet[] }) {
  const series = useMemo(() => computeGrowthRoicSeries(income, balance), [income, balance]);

  const plotted = useMemo<PlotPoint[]>(
    () =>
      series.flatMap((point) =>
        point.revenueGrowth === null || point.roic === null
          ? []
          : [{ fiscalYear: point.fiscalYear, revenueGrowth: point.revenueGrowth, roic: point.roic }],
      ),
    [series],
  );

  const guardedYears = series.filter((point) => point.guard === "reinvestment-base-too-small").map((p) => p.fiscalYear);
  const missingYears = series.filter((point) => point.guard === "insufficient-data").map((p) => p.fiscalYear);
  const noPriorYear = series
    .filter((point) => point.revenueGrowth === null && point.roic !== null)
    .map((p) => p.fiscalYear);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Growth vs Return on Capital</CardTitle>
        <p className="mt-1 text-sm text-foreground">
          Growth only creates value when returns on capital clear its cost.
        </p>
      </CardHeader>

      <CardContent className="space-y-3 pt-3">
        {plotted.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No fiscal year on file has both a year-over-year revenue comparison and a measurable return on invested
            capital, so there is nothing to plot.
          </p>
        ) : (
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 16, right: 24, bottom: 16, left: 0 }}>
                <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  dataKey="revenueGrowth"
                  name="Revenue growth"
                  tickFormatter={(v: number) => formatPercent(v, 0)}
                  tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
                  label={{
                    value: "Revenue growth (YoY)",
                    position: "insideBottom",
                    offset: -8,
                    fill: "var(--color-muted-foreground)",
                    fontSize: 12,
                  }}
                />
                <YAxis
                  type="number"
                  dataKey="roic"
                  name="ROIC"
                  tickFormatter={(v: number) => formatPercent(v, 0)}
                  tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
                  label={{
                    value: "Return on invested capital",
                    angle: -90,
                    position: "insideLeft",
                    fill: "var(--color-muted-foreground)",
                    fontSize: 12,
                  }}
                />
                <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: "3 3" }} />
                <ReferenceLine x={0} stroke="var(--color-border)" strokeDasharray="4 4" />
                <ReferenceLine
                  y={INDICATIVE_COST_OF_CAPITAL}
                  stroke="var(--color-muted-foreground)"
                  strokeOpacity={0.4}
                  strokeDasharray="4 4"
                  label={{
                    value: "indicative capital-cost zone — a convention, not an estimate",
                    position: "insideTopLeft",
                    fill: "var(--color-muted-foreground)",
                    fontSize: 10,
                  }}
                />
                <Scatter
                  data={plotted}
                  fill="var(--color-accent)"
                  fillOpacity={0.85}
                  line={{ stroke: "var(--color-accent)", strokeOpacity: 0.35, strokeWidth: 1 }}
                  lineType="joint"
                  isAnimationActive={false}
                >
                  <LabelList
                    dataKey="fiscalYear"
                    position="top"
                    fill="var(--color-muted-foreground)"
                    fontSize={10}
                    formatter={(value) => `FY${value}`}
                  />
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
          <p>
            Each point is one fiscal year, joined oldest to newest. The horizontal line sits at{" "}
            {formatPercent(INDICATIVE_COST_OF_CAPITAL, 0)} as a drawing convention, not as this company's cost of
            capital: the gap between a firm's true cost of capital and its measured return is usually smaller than the
            error in estimating either, so read the path — the direction and the persistence — rather than the distance
            from the line. Nothing here is scored or ranked.
          </p>
          {guardedYears.length > 0 && (
            <p>
              {guardedYears.map((year) => `FY${year}`).join(", ")} — not measurable (reinvestment base too small):
              equity plus debt less cash came to no more than{" "}
              {formatPercent(MIN_INVESTED_CAPITAL_SHARE_OF_ASSETS, 0)} of total assets, and a return divided by a base
              that small describes the balance sheet rather than the business.
            </p>
          )}
          {missingYears.length > 0 && (
            <p>
              {missingYears.map((year) => `FY${year}`).join(", ")} — not measurable (the statements on file are missing
              operating income or shareholders' equity).
            </p>
          )}
          {noPriorYear.length > 0 && (
            <p>
              {noPriorYear.map((year) => `FY${year}`).join(", ")} — plotted nowhere: no prior fiscal year is on file to
              measure growth against.
            </p>
          )}
          <p>
            Return on invested capital is operating income after tax, over shareholders' equity plus debt less cash. Tax
            is the company's own effective rate where the filing supports one. Ingested debt is long-term only, so the
            reinvestment base is understated for companies that lean on short-term borrowings.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
