import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer, Tooltip, Legend } from "recharts";

export interface SpiderSeries {
  name: string;
  color: string;
  values: Record<string, number | null>;
}

export function SpiderChart({ categories, series }: { categories: string[]; series: SpiderSeries[] }) {
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
        <RadarChart data={data} outerRadius="75%">
          <PolarGrid stroke="var(--color-border)" />
          <PolarAngleAxis dataKey="category" tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }} />
          {series.map((s) => (
            <Radar key={s.name} name={s.name} dataKey={s.name} stroke={s.color} fill={s.color} fillOpacity={0.2} />
          ))}
          {series.length > 1 && <Legend />}
          <Tooltip
            contentStyle={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
