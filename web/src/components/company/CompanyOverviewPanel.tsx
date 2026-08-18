import { useMemo } from "react";
import type { BalanceSheet, CashFlowStatement, Company, IncomeStatement, RankingResult } from "@proverbs/shared";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/Card";
import { ScorePill } from "../ui/ScorePill";
import {
  buildIdentityRows,
  buildScaleRows,
  fiscalSourceLabel,
  formatRankLine,
  isNonCalendarFiscalYearEnd,
  latestStatementYear,
  statementForYear,
  type OverviewRow,
} from "./companyOverview";

function RowList({ rows }: { rows: OverviewRow[] }) {
  return (
    <dl className="space-y-1.5">
      {rows.map((row) => (
        <div key={row.label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-sm">
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="text-right">
            {row.href ? (
              <a href={row.href} target="_blank" rel="noreferrer" className="underline decoration-dotted hover:text-accent">
                {row.value}
              </a>
            ) : (
              row.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function CompanyOverviewPanel({
  company,
  ranking,
  income,
  balance,
  cashFlow,
}: {
  company: Company;
  ranking: RankingResult | null;
  income: IncomeStatement[];
  balance: BalanceSheet[];
  cashFlow: CashFlowStatement[];
}) {
  const identityRows = useMemo(() => buildIdentityRows(company), [company]);

  const fiscalYear = useMemo(() => latestStatementYear(income, balance, cashFlow), [income, balance, cashFlow]);

  const approxMarketCap = company.latest?.priceSource === "sec_public_float";
  const scaleRows = useMemo(
    () =>
      buildScaleRows({
        income: statementForYear(income, fiscalYear),
        balance: statementForYear(balance, fiscalYear),
        cashFlow: statementForYear(cashFlow, fiscalYear),
        marketCap: company.latest?.marketCap ?? null,
        marketCapApproximate: approxMarketCap,
      }),
    [income, balance, cashFlow, fiscalYear, company.latest?.marketCap, approxMarketCap],
  );

  const rankLine = formatRankLine(ranking?.overallRank ?? null, ranking?.peerCount ?? null);

  const sourceNote =
    `Statement figures: ${fiscalSourceLabel(fiscalYear)}.` +
    (approxMarketCap
      ? " Market cap is marked ~ because no live quote was available: it is derived from the most recent SEC filing, not a current price."
      : "");

  const coverage = ranking?.coverage;
  const coverageNote = coverage
    ? `The score above rests on ${coverage.metricsIncluded} of the ${coverage.metricsApplicable} metrics that apply to this company` +
      (coverage.tier === "thin"
        ? " — a small enough share of the model that it is weaker evidence than a fully covered company's score."
        : ".")
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Overview</CardTitle>
      </CardHeader>

      <CardContent className="space-y-4 pt-2">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <section>
            <h4 className="mb-2 text-xs uppercase text-muted-foreground">Identity</h4>
            {identityRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No filer details on file for this company yet.</p>
            ) : (
              <RowList rows={identityRows} />
            )}
            {isNonCalendarFiscalYearEnd(company.fiscalYearEnd) && (
              <p className="mt-2 text-xs text-muted-foreground">
                Its financial year does not end in December, so the annual figures on this page cover a period offset
                from the calendar year — worth keeping in mind when comparing them to peers.
              </p>
            )}
          </section>

          <section>
            <h4 className="mb-2 text-xs uppercase text-muted-foreground">Scale and standing</h4>
            {scaleRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No annual statement figures are on file for this company yet.
              </p>
            ) : (
              <RowList rows={scaleRows} />
            )}

            <div className="mt-3 space-y-1.5 border-t border-border pt-3">
              {rankLine && (
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-sm">
                  <span className="text-muted-foreground">Overall rank</span>
                  <span className="text-right">{rankLine}</span>
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 text-sm">
                <span className="text-muted-foreground">Overall score</span>
                <ScorePill score={ranking?.overallScore ?? null} />
              </div>
            </div>
          </section>
        </div>

        <div className="space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
          <p>{sourceNote}</p>
          <p>
            Identity fields are the company's own SEC filer record. The SEC publishes no business description or
            website there, so this panel shows the filing classification rather than a written summary of what the
            company does.
          </p>
          {coverageNote && <p>{coverageNote}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
