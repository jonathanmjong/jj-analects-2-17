import { useMemo } from "react";
import type { BalanceSheet, CashFlowStatement, ForensicSeverity, IncomeStatement } from "@proverbs/shared";
import { computeForensicFlags, FORENSIC_CHECK_KEYS, FORENSIC_CHECK_LABELS } from "@proverbs/shared";
import { Badge, type BadgeProps } from "../ui/Badge";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/Card";
import { useForensicBaseRates } from "../../hooks/useForensicBaseRates";

const SEVERITY_LABEL: Record<ForensicSeverity, string> = {
  elevated: "Elevated",
  noteworthy: "Noteworthy",
};

const SEVERITY_VARIANT: Record<ForensicSeverity, NonNullable<BadgeProps["variant"]>> = {
  elevated: "negative",
  noteworthy: "accent",
};

const SEVERITY_RULE: Record<ForensicSeverity, string> = {
  elevated: "border-negative/40",
  noteworthy: "border-accent/40",
};

export function ForensicPanel({
  income,
  balance,
  cashFlow,
  marketCap,
  sector,
}: {
  income: IncomeStatement[];
  balance: BalanceSheet[];
  cashFlow: CashFlowStatement[];
  marketCap: number | null;
  sector: string | null;
}) {
  const report = useMemo(
    () => computeForensicFlags({ income, balance, cashFlow, marketCap, sector }),
    [income, balance, cashFlow, marketCap, sector],
  );
  const { data: baseRates } = useForensicBaseRates();

  const latestFiscalYear = useMemo(() => {
    const years = [...income, ...balance, ...cashFlow]
      .map((s) => s.fiscalYear)
      .filter((y): y is number => typeof y === "number");
    return years.length > 0 ? Math.max(...years) : null;
  }, [income, balance, cashFlow]);

  const period = latestFiscalYear === null ? "the latest fiscal year" : `FY${latestFiscalYear}`;
  const { flags, suppressed, checkedCount } = report;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Forensic Checks</CardTitle>
      </CardHeader>

      <CardContent className="space-y-4 pt-2">
        {checkedCount === 0 ? (
          <p className="text-sm text-muted-foreground">
            None of the {FORENSIC_CHECK_KEYS.length} checks could be evaluated — the annual statements on file are
            missing the line items they read.
          </p>
        ) : flags.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No forensic flags at {period}. {checkedCount} of {FORENSIC_CHECK_KEYS.length} checks had the data to run.
          </p>
        ) : (
          <ul className="space-y-3">
            {flags.map((flag) => {
              const rate = baseRates?.rates?.[flag.key];
              return (
                <li key={flag.key} className={`border-l-2 pl-3 ${SEVERITY_RULE[flag.severity]}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={SEVERITY_VARIANT[flag.severity]}>{SEVERITY_LABEL[flag.severity]}</Badge>
                    <span className="text-sm font-medium">{flag.label}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{flag.detail}</p>
                  {rate && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {rate.pct}% of covered companies also trip this.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
          {flags.length > 0 && (
            <p>
              {checkedCount} of {FORENSIC_CHECK_KEYS.length} checks ran on {period} annual statements. Each is a
              descriptive condition worth reading the filings about, not a conclusion about the company.
            </p>
          )}
          {suppressed.length > 0 && (
            <p>
              Withheld:{" "}
              {suppressed.map((s, i) => (
                <span key={s.key}>
                  {i > 0 && "; "}
                  {FORENSIC_CHECK_LABELS[s.key]} — {s.reason}
                </span>
              ))}
              .
            </p>
          )}
          {baseRates && (
            <p>
              Base rates cover {baseRates.totalCompanies.toLocaleString("en-US")} companies with usable statements, as of{" "}
              {baseRates.asOf.slice(0, 10)}.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
