import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PriceHistoryPoint } from "@proverbs/shared";
import { cn, formatCurrency, formatPercent } from "../../lib/utils";

const TIMEFRAMES = [
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
  { label: "All", days: null },
] as const;

type TimeframeLabel = (typeof TIMEFRAMES)[number]["label"];

interface ChartPoint extends PriceHistoryPoint {
  ma50: number | null;
  ma200: number | null;
}

/** Trailing simple moving average ending at each point — null until `windowDays` of prior data
 * exists, rather than a fabricated average over a shorter, misleadingly-labeled window. Computed
 * over the full series (not the timeframe-filtered slice) so a 200-day line stays correct even
 * when the visible window is zoomed into the last month. */
export function withMovingAverages(points: PriceHistoryPoint[]): ChartPoint[] {
  const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return sorted.map((p, idx) => {
    const ma = (windowDays: number) => {
      if (idx + 1 < windowDays) return null;
      const window = sorted.slice(idx + 1 - windowDays, idx + 1);
      return window.reduce((sum, w) => sum + w.close, 0) / window.length;
    };
    return { ...p, ma50: ma(50), ma200: ma(200) };
  });
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ChartPoint }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-sm">
      <div className="text-muted-foreground">{d.date}</div>
      <div className="font-semibold">{formatCurrency(d.close)}</div>
      {d.ma50 !== null && <div className="text-[11px] text-accent">50D MA: {formatCurrency(d.ma50)}</div>}
      {d.ma200 !== null && <div className="text-[11px] text-negative">200D MA: {formatCurrency(d.ma200)}</div>}
    </div>
  );
}

/** Daily closing-price series with a timeframe filter — deliberately a separate component from
 * HistoryLineChart, which is tuned for a handful of annual/quarterly points (dots, dense x-axis
 * labels); a ~250-point daily series needs a plain line with no per-point dots and sparse ticks.
 * 50/200-day moving averages are a visual reference only, not fed into the ranking engine — like
 * momentum generally, they're not a value-investing signal in this app's philosophy (see the
 * Admin page's Value Metrics panel). */
export function PriceHistoryChart({ points }: { points: PriceHistoryPoint[] }) {
  const [timeframe, setTimeframe] = useState<TimeframeLabel>("3M");

  const withMa = useMemo(() => withMovingAverages(points), [points]);

  const filtered = useMemo(() => {
    const frame = TIMEFRAMES.find((t) => t.label === timeframe);
    if (!frame?.days) return withMa;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - frame.days);
    const cutoffKey = cutoff.toISOString().slice(0, 10);
    return withMa.filter((p) => p.date >= cutoffKey);
  }, [withMa, timeframe]);

  const change = useMemo(() => {
    if (filtered.length < 2) return null;
    const first = filtered[0].close;
    const last = filtered[filtered.length - 1].close;
    if (first === 0) return null;
    return (last - first) / first;
  }, [filtered]);

  const hasMa50 = filtered.some((p) => p.ma50 !== null);
  const hasMa200 = filtered.some((p) => p.ma200 !== null);

  if (points.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No price history available for this company yet.</p>;
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          {TIMEFRAMES.map((t) => (
            <button
              key={t.label}
              type="button"
              onClick={() => setTimeframe(t.label)}
              className={cn(
                "rounded-md px-2 py-1 text-xs font-medium transition-colors",
                timeframe === t.label
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-surface-hover",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {(hasMa50 || hasMa200) && (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              {hasMa50 && (
                <span className="flex items-center gap-1">
                  <span className="h-0.5 w-3 bg-accent" /> 50D
                </span>
              )}
              {hasMa200 && (
                <span className="flex items-center gap-1">
                  <span className="h-0.5 w-3 bg-negative" /> 200D
                </span>
              )}
            </div>
          )}
          {change !== null && (
            <span className={cn("text-sm font-medium", change >= 0 ? "text-positive" : "text-negative")}>
              {change >= 0 ? "+" : ""}
              {formatPercent(change)} over {timeframe}
            </span>
          )}
        </div>
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={filtered} margin={{ left: 8, right: 8, top: 8 }}>
            <defs>
              <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.25} />
                <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
              minTickGap={40}
              tickFormatter={(v: string) => v.slice(5)}
            />
            <YAxis
              domain={["auto", "auto"]}
              tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
              tickFormatter={(v: number) => formatCurrency(v)}
              width={64}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="close"
              stroke="var(--color-accent)"
              strokeWidth={2}
              fill="url(#priceFill)"
              dot={false}
              activeDot={{ r: 4 }}
            />
            {hasMa50 && (
              <Line
                type="monotone"
                dataKey="ma50"
                stroke="var(--color-accent)"
                strokeWidth={1}
                strokeDasharray="4 3"
                strokeOpacity={0.6}
                dot={false}
                activeDot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            )}
            {hasMa200 && (
              <Line
                type="monotone"
                dataKey="ma200"
                stroke="var(--color-negative)"
                strokeWidth={1}
                strokeDasharray="4 3"
                strokeOpacity={0.6}
                dot={false}
                activeDot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
