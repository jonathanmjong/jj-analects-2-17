import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: PriceHistoryPoint }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-sm">
      <div className="text-muted-foreground">{d.date}</div>
      <div className="font-semibold">{formatCurrency(d.close)}</div>
    </div>
  );
}

/** Daily closing-price series with a timeframe filter — deliberately a separate component from
 * HistoryLineChart, which is tuned for a handful of annual/quarterly points (dots, dense x-axis
 * labels); a ~250-point daily series needs a plain line with no per-point dots and sparse ticks. */
export function PriceHistoryChart({ points }: { points: PriceHistoryPoint[] }) {
  const [timeframe, setTimeframe] = useState<TimeframeLabel>("3M");

  const filtered = useMemo(() => {
    const frame = TIMEFRAMES.find((t) => t.label === timeframe);
    if (!frame?.days) return points;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - frame.days);
    const cutoffKey = cutoff.toISOString().slice(0, 10);
    return points.filter((p) => p.date >= cutoffKey);
  }, [points, timeframe]);

  const change = useMemo(() => {
    if (filtered.length < 2) return null;
    const first = filtered[0].close;
    const last = filtered[filtered.length - 1].close;
    if (first === 0) return null;
    return (last - first) / first;
  }, [filtered]);

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
        {change !== null && (
          <span className={cn("text-sm font-medium", change >= 0 ? "text-positive" : "text-negative")}>
            {change >= 0 ? "+" : ""}
            {formatPercent(change)} over {timeframe}
          </span>
        )}
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
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
