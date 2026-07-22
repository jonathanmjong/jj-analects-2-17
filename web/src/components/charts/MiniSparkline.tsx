import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";

export function MiniSparkline({ data, positive }: { data: Array<{ value: number }>; positive: boolean }) {
  if (data.length < 2) {
    return <div className="h-10 w-24 text-xs text-muted-foreground">—</div>;
  }
  return (
    <div className="h-10 w-24">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Line
            type="monotone"
            dataKey="value"
            stroke={positive ? "var(--color-positive)" : "var(--color-negative)"}
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
