import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { formatCurrency, formatPercent } from "../../lib/utils";

export interface ScatterDatum {
  ticker: string;
  companyName: string;
  sector: string;
  roic: number;
  revenueGrowth1y: number;
  marketCap: number;
}

const SECTOR_COLORS: Record<string, string> = {
  Technology: "#2383e2",
  Healthcare: "#2f7e4f",
  Financials: "#9c6ade",
  "Consumer Discretionary": "#e0668c",
  "Consumer Staples": "#d4a72c",
  Energy: "#bf4c44",
  Utilities: "#6d8a96",
  Industrials: "#b4652f",
  "Real Estate": "#2fa3b3",
  "Communication Services": "#4c6ef5",
  Materials: "#8a7a5c",
};

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ScatterDatum }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-sm">
      <div className="font-semibold">
        {d.ticker} — {d.companyName}
      </div>
      <div className="text-muted-foreground">{d.sector}</div>
      <div className="mt-1">ROIC: {formatPercent(d.roic)}</div>
      <div>Revenue Growth (1Y): {formatPercent(d.revenueGrowth1y)}</div>
      <div>Market Cap: {formatCurrency(d.marketCap, { compact: true })}</div>
    </div>
  );
}

export function QualityGrowthScatter({ data, onSelect }: { data: ScatterDatum[]; onSelect?: (ticker: string) => void }) {
  const bySector = new Map<string, ScatterDatum[]>();
  for (const d of data) {
    (bySector.get(d.sector) ?? bySector.set(d.sector, []).get(d.sector)!).push(d);
  }

  return (
    <div className="h-96 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
          <XAxis
            type="number"
            dataKey="roic"
            name="ROIC"
            tickFormatter={(v) => formatPercent(v, 0)}
            tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
            label={{ value: "ROIC", position: "insideBottom", offset: -4, fill: "var(--color-muted-foreground)", fontSize: 12 }}
          />
          <YAxis
            type="number"
            dataKey="revenueGrowth1y"
            name="Revenue Growth (1Y)"
            tickFormatter={(v) => formatPercent(v, 0)}
            tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
            label={{ value: "Revenue Growth (1Y)", angle: -90, position: "insideLeft", fill: "var(--color-muted-foreground)", fontSize: 12 }}
          />
          <ZAxis type="number" dataKey="marketCap" range={[30, 400]} />
          <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: "3 3" }} />
          {[...bySector.entries()].map(([sector, points]) => (
            <Scatter
              key={sector}
              name={sector}
              data={points}
              fill={SECTOR_COLORS[sector] ?? "var(--color-accent)"}
              fillOpacity={0.7}
              onClick={(point) => onSelect?.((point as unknown as ScatterDatum).ticker)}
              cursor={onSelect ? "pointer" : undefined}
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
