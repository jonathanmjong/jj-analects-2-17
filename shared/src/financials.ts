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
