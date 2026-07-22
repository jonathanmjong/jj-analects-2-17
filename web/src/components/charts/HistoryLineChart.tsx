import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function HistoryLineChart({
  data,
  dataKey,
  label,
  formatValue,
}: {
  data: Array<{ periodKey: string; value: number | null }>;
  dataKey?: string;
  label: string;
  formatValue?: (v: number) => string;
}) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ left: 8, right: 8, top: 8 }}>
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
          <XAxis dataKey="periodKey" tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }} />
          <YAxis
            tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
            tickFormatter={(v) => (formatValue ? formatValue(v) : String(v))}
            width={64}
          />
          <Tooltip
            formatter={(v) => (formatValue ? formatValue(Number(v)) : String(v))}
            contentStyle={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Line
            type="monotone"
            dataKey={dataKey ?? "value"}
            name={label}
            stroke="var(--color-accent)"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
