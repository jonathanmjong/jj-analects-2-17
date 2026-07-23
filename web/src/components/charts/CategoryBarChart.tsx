import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface BarSeries {
  name: string;
  color: string;
  values: Record<string, number | null>;
}

export function CategoryBarChart({ categories, series }: { categories: string[]; series: BarSeries[] }) {
  const data = categories.map((category) => {
    const row: Record<string, number | string> = { category };
    for (const s of series) {
      row[s.name] = s.values[category] ?? 0;
    }
    return row;
  });

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 40 }}>
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="category"
            tick={{ fill: "var(--color-muted-foreground)", fontSize: 10 }}
            interval={0}
            angle={-30}
            textAnchor="end"
          />
          <YAxis tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }} domain={[0, 100]} />
          <Tooltip
            contentStyle={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {series.map((s) => (
            <Bar key={s.name} dataKey={s.name} fill={s.color} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
