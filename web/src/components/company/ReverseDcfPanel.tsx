import { useMemo, useState } from "react";
import type { BalanceSheet, CashFlowStatement, IncomeStatement } from "@proverbs/shared";
import { computeReverseDcf, solveImpliedGrowth } from "@proverbs/shared";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/Card";
import { formatCurrency } from "../../lib/utils";

const CUSTOM_DISCOUNT_RATES = Array.from({ length: 17 }, (_, i) => 0.06 + i * 0.005);

/**
 * At most 2 significant figures — a back-solved growth rate is a band, and a
 * third digit would claim precision the inputs cannot carry.
 */
function growthText(value: number | null, withUnit = true): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const pct = value * 100;
  return `${pct.toFixed(Math.abs(pct) >= 10 ? 0 : 1)}${withUnit ? "%" : ""}`;
}

function rateText(rate: number): string {
  return `${+(rate * 100).toFixed(1)}%`;
}

export function ReverseDcfPanel({
  income,
  balance,
  cashFlow,
  sector,
  sharePrice,
  sharesOutstanding,
}: {
  income: IncomeStatement[];
  balance: BalanceSheet[];
  cashFlow: CashFlowStatement[];
  sector: string | null;
  sharePrice: number | null;
  sharesOutstanding: number | null;
}) {
  const [customRate, setCustomRate] = useState<number | null>(null);

  const result = useMemo(
    () => computeReverseDcf({ income, balance, cashFlow, sector, sharePrice, sharesOutstanding }),
    [income, balance, cashFlow, sector, sharePrice, sharesOutstanding],
  );

  const customGrowth = useMemo(() => {
    const { trailingFcf, netDebt, sharePrice: price, sharesOutstanding: shares, fadeYears, terminalGrowth } = result.assumptions;
    if (customRate === null || result.status !== "ok" || trailingFcf === null || netDebt === null || price === null || shares === null) {
      return null;
    }
    return solveImpliedGrowth({
      price,
      sharesOutstanding: shares,
      netDebt,
      trailingFcf,
      discountRate: customRate,
      fadeYears,
      terminalGrowth,
    });
  }, [customRate, result]);

  const { assumptions, realized } = result;
  const growths = (result.implied ?? []).map((point) => point.growth);
  const horizon = assumptions.fadeYears === 10 ? "a decade" : `${assumptions.fadeYears} years`;

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Market-Implied Growth — Reverse DCF</CardTitle>
        {result.status === "ok" && (
          <select
            value={customRate === null ? "band" : String(customRate)}
            onChange={(e) => setCustomRate(e.target.value === "band" ? null : Number(e.target.value))}
            className="h-8 rounded-md border border-border bg-surface px-2 text-sm text-foreground"
            aria-label="Discount rate"
          >
            <option value="band">Band: {assumptions.discountRates.map(rateText).join(" / ")}</option>
            {CUSTOM_DISCOUNT_RATES.map((rate) => (
              <option key={rate} value={rate}>
                Add {rateText(rate)} discount rate
              </option>
            ))}
          </select>
        )}
      </CardHeader>

      <CardContent className="space-y-4 pt-2">
        {result.status === "suppressed" ? (
          <p className="text-sm text-muted-foreground">
            No implied growth rate is shown here because {result.reason}.
          </p>
        ) : (
          <p className="text-base">
            Priced as if free cash flow grows{" "}
            <span className="font-medium">
              ~{growthText(Math.min(...growths), false)}–{growthText(Math.max(...growths))}/yr
            </span>{" "}
            for {horizon}, then {growthText(assumptions.terminalGrowth)}/yr forever.
          </p>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {result.status === "ok" && (
            <div>
              <h4 className="mb-2 text-xs uppercase text-muted-foreground">Implied by today's price</h4>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-muted-foreground">
                    <th className="py-1 pr-4 font-medium">Discount rate</th>
                    <th className="py-1 text-right font-medium">Implied FCF growth</th>
                  </tr>
                </thead>
                <tbody>
                  {(result.implied ?? []).map((point) => (
                    <tr key={point.discountRate} className="border-t border-border">
                      <td className="py-2 pr-4 text-muted-foreground">{rateText(point.discountRate)}</td>
                      <td className="py-2 text-right">{growthText(point.growth)}/yr</td>
                    </tr>
                  ))}
                  {customRate !== null && (
                    <tr className="border-t border-border">
                      <td className="py-2 pr-4 text-muted-foreground">
                        {rateText(customRate)} <span className="text-xs">· your rate</span>
                      </td>
                      <td className="py-2 text-right">
                        {customGrowth === null ? (
                          <span className="text-xs text-muted-foreground">
                            outside the {growthText(assumptions.growthBounds.min)} to {growthText(assumptions.growthBounds.max)} solvable range
                          </span>
                        ) : (
                          `${growthText(customGrowth)}/yr`
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {realized.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs uppercase text-muted-foreground">Already delivered</h4>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-muted-foreground">
                    <th className="py-1 pr-4 font-medium">Window</th>
                    <th className="py-1 pr-4 text-right font-medium">FCF CAGR</th>
                    <th className="py-1 text-right font-medium">Revenue CAGR</th>
                  </tr>
                </thead>
                <tbody>
                  {realized.map((window) => (
                    <tr key={window.label} className="border-t border-border">
                      <td className="py-2 pr-4 text-muted-foreground">{window.label}</td>
                      <td className="py-2 pr-4 text-right">{growthText(window.fcfCagr)}/yr</td>
                      <td className="py-2 text-right">{growthText(window.revenueCagr)}/yr</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
          <p>
            Conventions, not forecasts — every figure below is an assumption you can disagree with. Stage-one growth
            fades linearly to a {growthText(assumptions.terminalGrowth)} terminal rate over {assumptions.fadeYears} years,
            followed by a Gordon terminal value; the solver searches {growthText(assumptions.growthBounds.min)} to{" "}
            {growthText(assumptions.growthBounds.max)} and reports nothing outside it.
          </p>
          <p>
            FCF base {formatCurrency(assumptions.trailingFcf, { compact: true })} ({assumptions.fcfBasis ?? "unavailable"}
            {assumptions.fcfBasisYears.length > 0 && `, FY${assumptions.fcfBasisYears.join(" + FY")}`}) · net debt{" "}
            {formatCurrency(assumptions.netDebt, { compact: true })} (long-term debt{" "}
            {formatCurrency(assumptions.totalDebt, { compact: true })} less cash{" "}
            {formatCurrency(assumptions.cashAndEquivalents, { compact: true })} — short-term debt is not carried by the
            data source) · enterprise value {formatCurrency(assumptions.enterpriseValue, { compact: true })} at{" "}
            {formatCurrency(assumptions.sharePrice)} per share.
          </p>
          <p>
            The consistency gate that decides whether this panel computes at all reads{" "}
            {assumptions.fiscalYears.length} fiscal years of annual statements — shorter than the decade this test is
            normally run over. Revenue per share deviates {assumptions.revenueCv === null ? "—" : assumptions.revenueCv.toFixed(2)} from
            its own trend (limit {assumptions.revenueCvLimit.toFixed(2)}), FCF per share{" "}
            {assumptions.fcfCv === null ? "—" : assumptions.fcfCv.toFixed(2)} (limit {assumptions.fcfCvLimit.toFixed(2)}).
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
