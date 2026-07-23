import { ResponsiveContainer, Treemap, Tooltip } from "recharts";
import { formatCurrency } from "../../lib/utils";

export interface SectorTreemapDatum {
  name: string;
  size: number;
  avgScore: number | null;
  count: number;
  [key: string]: unknown;
}

function scoreToColor(score: number | null): string {
  if (score === null) return "var(--color-surface-muted)";
  if (score >= 70) return "var(--color-positive)";
  if (score >= 40) return "var(--color-accent)";
  return "var(--color-negative)";
}

function TreemapCell(props: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  avgScore?: number | null;
  count?: number;
}) {
  const { x = 0, y = 0, width = 0, height = 0, name, avgScore, count } = props;
  const showLabel = width > 60 && height > 36;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        style={{ fill: scoreToColor(avgScore ?? null), fillOpacity: 0.75, stroke: "var(--color-background)", strokeWidth: 2 }}
      />
      {showLabel && (
        <text x={x + 8} y={y + 20} fontSize={12} fontWeight={600} fill="#fff">
          {name}
        </text>
      )}
      {showLabel && (
        <text x={x + 8} y={y + 36} fontSize={11} fill="#fff" fillOpacity={0.85}>
          {count} co. {avgScore !== null && avgScore !== undefined ? `· ${avgScore.toFixed(0)}` : ""}
        </text>
      )}
    </g>
  );
}

export function SectorTreemap({ data }: { data: SectorTreemapDatum[] }) {
  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <Treemap
          data={data}
          dataKey="size"
          aspectRatio={4 / 3}
          stroke="var(--color-background)"
          content={<TreemapCell />}
          isAnimationActive={false}
        >
          <Tooltip
            formatter={(value) => formatCurrency(Number(value), { compact: true })}
            contentStyle={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
        </Treemap>
      </ResponsiveContainer>
    </div>
  );
}
