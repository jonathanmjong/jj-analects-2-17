export type PeriodType = "FY" | "Q1" | "Q2" | "Q3" | "Q4" | "TTM";

export interface StatementPeriodMeta {
  /** Doc id, e.g. "2024-FY" or "2024-Q3" */
  periodKey: string;
  periodType: PeriodType;
  fiscalYear: number;
  periodEnd: string;
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
