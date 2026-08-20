export type PeriodType = "FY" | "Q1" | "Q2" | "Q3" | "Q4" | "TTM";

export interface StatementPeriodMeta {
  /** Doc id, e.g. "2024-FY" or "2024-Q3" */
  periodKey: string;
  periodType: PeriodType;
  fiscalYear: number;
  periodEnd: string;
  /**
   * The date this row's numbers became PUBLIC: the LATEST SEC `filed` date among the XBRL facts
   * that supplied the values on this row, or null when no usable date exists.
   *
   * Why the latest and not the first-reported date. A row is assembled per concept, and each
   * concept resolves to the most recently filed fact for that fiscal period end ("later `filed`
   * wins"), so a restated figure REPLACES the original. The values on the row are therefore the
   * restated ones, and the earliest contributing filing did not contain them. Stamping this row
   * with the original 10-K's date would assert that these numbers were knowable months or years
   * before they existed — the exact look-ahead bias this field is here to make detectable. The
   * maximum is the only date the whole row is simultaneously true as of, and it is the
   * conservative direction: it can only ever delay when a backtest may use the row, never let it
   * peek. Read it as "as filed up to", not "first reported".
   *
   * Consequences worth knowing before using it:
   * - It is usually NOT the date that fiscal year's own 10-K was filed, for any year but the
   *   latest. A 10-K repeats prior years as comparative columns, and the newest filing that
   *   repeats a period is the one whose numbers win — so the value really did come from that
   *   later filing and the date says so. Verified on EDGAR 2026-08: Apple's FY2022 income row
   *   reads 2024-11-01 (the FY2024 10-K's comparative column), and its FY2022 balance row reads
   *   2025-10-31 because the FY2025 10-K's statement of equity still carries FY2022 balances.
   *   The two differ because each row maxes over its own contributors, and 2025-10-31 is the
   *   first date on which every number on that balance row was simultaneously public.
   * - It is NOT a stable identifier of the original filing. When a period is later restated, a
   *   re-ingest moves this date forward for that same periodKey; a date that advances between
   *   ingests IS the restatement signal (no second field is needed to detect one, and a second
   *   vaguer date would just invite mixing the two meanings).
   * - Different rows of the same fiscal year (income vs balance vs cash flow) can carry different
   *   dates. Each is the max over its OWN contributing facts.
   * - A point-in-time backtest must gate on this, not on `periodEnd`, and must accept that a row
   *   whose filedAt is null has no defensible as-of date at all.
   * - `periodEnd` from the SEC provider is a synthetic `${fiscalYear}-12-31`, not the true fiscal
   *   period end, so filedAt < periodEnd is expected and harmless for non-December filers (Apple's
   *   FY2025 ends 2025-09-27 and was filed 2025-10-30, both inside a periodEnd of 2025-12-31).
   *   Compare filedAt against the real fiscal period end, never against this field.
   *
   * Never fabricated: a filer whose facts carry no parseable `filed` — or one whose `filed`
   * precedes the period it reports, which no real filing does — yields null. Today's date is
   * never substituted — a wrong as-of date is worse than an absent one, because it is silently
   * usable.
   */
  filedAt: string | null;
  sourceProvider: string;
}

/** Firestore subcollection: companies/{ticker}/incomeStatements/{periodKey} */
export interface IncomeStatement extends StatementPeriodMeta {
  revenue: number | null;
  costOfRevenue: number | null;
  grossProfit: number | null;
  researchAndDevelopment: number | null;
  operatingIncome: number | null;
  ebit: number | null;
  ebitda: number | null;
  interestExpense: number | null;
  pretaxIncome: number | null;
  incomeTaxExpense: number | null;
  netIncome: number | null;
  eps: number | null;
  epsDiluted: number | null;
  sharesOutstandingDiluted: number | null;
}

/** Firestore subcollection: companies/{ticker}/balanceSheets/{periodKey} */
export interface BalanceSheet extends StatementPeriodMeta {
  cashAndEquivalents: number | null;
  shortTermInvestments: number | null;
  receivables: number | null;
  inventory: number | null;
  totalCurrentAssets: number | null;
  totalAssets: number | null;
  intangibleAssets: number | null;
  goodwill: number | null;
  totalCurrentLiabilities: number | null;
  accountsPayable: number | null;
  shortTermDebt: number | null;
  longTermDebt: number | null;
  /**
   * USUALLY long-term debt excluding current maturities — `shortTermDebt` is never populated, so
   * this is not "total debt" in the textbook sense for most companies.
   *
   * The exception, and the reason this is not a flat promise: the SEC EDGAR provider resolves it
   * through a tag-precedence list (see TOTAL_DEBT_TAGS), and its lower-precedence tags carry
   * BROADER quantities — `LongTermDebt` and
   * `LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities` include current maturities,
   * and `DebtLongtermAndShorttermCombinedAmount` (last resort, ~1% of the universe) includes
   * short-term borrowings, making this genuinely total debt for those filers. Reading only the
   * long-term-noncurrent tag left ~half the universe null, and null is not harmless here: a
   * missing figure is treated as ZERO debt when enterprise value is formed, which understates EV
   * and makes leveraged companies look cheap. A slightly broader basis for some filers is the
   * lesser error, but the basis is NOT uniform across companies — do not treat small
   * cross-company differences in debt-derived ratios as meaningful.
   */
  totalDebt: number | null;
  totalLiabilities: number | null;
  totalEquity: number | null;
  tangibleBookValue: number | null;
  retainedEarnings: number | null;
}

/** Firestore subcollection: companies/{ticker}/cashFlowStatements/{periodKey} */
export interface CashFlowStatement extends StatementPeriodMeta {
  operatingCashFlow: number | null;
  capitalExpenditures: number | null;
  /**
   * Optional rather than `number | null` because every statement written before this field
   * existed (2026-08) genuinely lacks the key — a Firestore document read back as a
   * CashFlowStatement will have it `undefined` until the statement-refresh jobs re-run, and
   * providers that don't carry the line item never set it. Consumers must treat undefined and
   * null identically (`?? null`), never assume a number is present.
   */
  depreciationAndAmortization?: number | null;
  /**
   * Share-based compensation, as reported on the cash flow statement (it is a non-cash add-back
   * to operating cash flow, which is where filers present it). Optional for exactly the reason
   * `depreciationAndAmortization` is — statements written before this field existed (2026-08)
   * lack the key entirely, so consumers must treat undefined and null identically (`?? null`).
   *
   * Null is a real answer, not a gap to fill with zero: some filers never tag the concept at all
   * (verified on EDGAR — Exxon Mobil, CIK 0000034088, reports it under neither candidate tag in
   * any year), and reading that as "$0 of stock compensation" would rank a filer with no
   * disclosure as the most shareholder-friendly in the universe.
   */
  shareBasedCompensation?: number | null;
  freeCashFlow: number | null;
  dividendsPaid: number | null;
  stockBuybacks: number | null;
  stockIssuance: number | null;
  netDebtIssuance: number | null;
}

export interface StatementBundle {
  income: IncomeStatement;
  balance: BalanceSheet;
  cashFlow: CashFlowStatement;
  /** Prior-period bundle for the same fiscal position one year back, used for growth/turnover math. */
  priorYear?: StatementBundle;
}
