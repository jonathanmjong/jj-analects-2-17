import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCurrency } from "../../lib/utils";

export interface WaterfallInput {
  revenue: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  pretaxIncome: number | null;
  netIncome: number | null;
}

interface WaterfallStep {
  name: string;
  base: number;
  value: number;
  isSubtotal: boolean;
  raw: number;
}

/**
 * Recharts has no built-in waterfall type — this is the standard trick: an
 * invisible "base" series stacked under a colored "value" series, so each
 * bar visually floats at the right height. Subtotal steps (Revenue, Gross
 * Profit, Operating Income, Pretax Income, Net Income) draw from zero;
 * bridge steps (the cost/expense/tax deltas between them) float between the
 * two subtotals they connect.
 */
function buildSteps(input: WaterfallInput): WaterfallStep[] {
  const steps: WaterfallStep[] = [];
  const { revenue, grossProfit, operatingIncome, pretaxIncome, netIncome } = input;
  if (revenue === null) return steps;

  steps.push({ name: "Revenue", base: 0, value: revenue, isSubtotal: true, raw: revenue });

  if (grossProfit !== null) {
    const delta = grossProfit - revenue;
    steps.push({
      name: "Cost of Revenue",
      base: Math.min(revenue, grossProfit),
      value: Math.abs(delta),
      isSubtotal: false,
      raw: delta,
    });
    steps.push({ name: "Gross Profit", base: 0, value: grossProfit, isSubtotal: true, raw: grossProfit });

    if (operatingIncome !== null) {
      const opDelta = operatingIncome - grossProfit;
      steps.push({
        name: "Operating Expenses",
        base: Math.min(grossProfit, operatingIncome),
        value: Math.abs(opDelta),
        isSubtotal: false,
        raw: opDelta,
      });
      steps.push({ name: "Operating Income", base: 0, value: operatingIncome, isSubtotal: true, raw: operatingIncome });

      if (pretaxIncome !== null) {
        const nonOpDelta = pretaxIncome - operatingIncome;
        steps.push({
          name: "Non-Operating Items",
          base: Math.min(operatingIncome, pretaxIncome),
          value: Math.abs(nonOpDelta),
          isSubtotal: false,
          raw: nonOpDelta,
        });
        steps.push({ name: "Pretax Income", base: 0, value: pretaxIncome, isSubtotal: true, raw: pretaxIncome });

        if (netIncome !== null) {
          const taxDelta = netIncome - pretaxIncome;
          steps.push({
            name: "Taxes",
            base: Math.min(pretaxIncome, netIncome),
            value: Math.abs(taxDelta),
            isSubtotal: false,
            raw: taxDelta,
          });
          steps.push({ name: "Net Income", base: 0, value: netIncome, isSubtotal: true, raw: netIncome });
        }
      }
    }
  }

  return steps;
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: WaterfallStep }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-sm">
      <div className="font-semibold">{d.name}</div>
      <div>{formatCurrency(d.raw, { compact: true })}</div>
    </div>
  );
}

export function IncomeWaterfall({ data }: { data: WaterfallInput }) {
  const steps = buildSteps(data);
  if (steps.length === 0) {
    return <p className="text-sm text-muted-foreground">Not enough statement data to build a bridge chart.</p>;
  }

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={steps} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="name" tick={{ fill: "var(--color-muted-foreground)", fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={60} />
          <YAxis tickFormatter={(v) => formatCurrency(v, { compact: true })} tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }} width={64} />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "var(--color-surface-hover)" }} />
          <Bar dataKey="base" stackId="waterfall" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="value" stackId="waterfall" isAnimationActive={false} radius={[2, 2, 2, 2]}>
            {steps.map((step, idx) => (
              <Cell
                key={idx}
                fill={
                  step.isSubtotal
                    ? "var(--color-accent)"
                    : step.raw >= 0
                      ? "var(--color-positive)"
                      : "var(--color-negative)"
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
