import type { BalanceSheet, CashFlowStatement, IncomeStatement } from "./financials.js";

export type ForensicSeverity = "elevated" | "noteworthy";

export type ForensicCheckKey =
  | "altmanZ"
  | "accrualDivergence"
  | "receivablesVsRevenue"
  | "inventoryBuild"
  | "grossMarginErosion"
  | "shareCountGrowth"
  | "earningsQualityIndex";

export const FORENSIC_CHECK_KEYS: ForensicCheckKey[] = [
  "altmanZ",
  "accrualDivergence",
  "receivablesVsRevenue",
  "inventoryBuild",
  "grossMarginErosion",
  "shareCountGrowth",
  "earningsQualityIndex",
];

/** Names for the checks themselves (a check can be run, suppressed, or trip a flag). */
export const FORENSIC_CHECK_LABELS: Record<ForensicCheckKey, string> = {
  altmanZ: "Balance-sheet distress model",
  accrualDivergence: "Accruals versus cash collection",
  receivablesVsRevenue: "Receivables versus revenue",
  inventoryBuild: "Inventory versus revenue",
  grossMarginErosion: "Gross margin trend",
  shareCountGrowth: "Diluted share count",
  earningsQualityIndex: "Composite earnings-quality index",
};

export interface ForensicFlag {
  key: ForensicCheckKey;
  label: string;
  severity: ForensicSeverity;
  detail: string;
  /** The headline figure quoted in `detail`, in the unit `detail` names (percent, pp, bps or an index level). */
  value?: number;
}

export interface ForensicSuppression {
  key: ForensicCheckKey;
  reason: string;
}

export interface ForensicReport {
  flags: ForensicFlag[];
  /** Checks deliberately not run because the model is invalid for this company, with the reason. */
  suppressed: ForensicSuppression[];
  /** How many checks had enough non-null data to actually evaluate (whether or not they tripped). */
  checkedCount: number;
}

export interface ForensicInput {
  income: IncomeStatement[];
  balance: BalanceSheet[];
  cashFlow: CashFlowStatement[];
  marketCap: number | null;
  sector: string | null;
}

/**
 * Altman Z and the Beneish-style index are built on manufacturing/retail balance-sheet
 * structure — working capital, inventory turns, receivable days. Banks, insurers and REITs
 * score badly on both by construction rather than by condition, so the checks are withheld
 * with a reason instead of being displayed wrong.
 */
const MODEL_INAPPLICABLE_SECTORS = new Set(["Financials", "Real Estate"]);

interface Period {
  fiscalYear: number;
  income: IncomeStatement | null;
  balance: BalanceSheet | null;
  cashFlow: CashFlowStatement | null;
}

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Growth is only meaningful off a positive base — a negative or zero prior flips or explodes it. */
function growthRate(current: number | null, prior: number | null): number | null {
  if (current === null || prior === null || prior <= 0) return null;
  return (current - prior) / prior;
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return numerator / denominator;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function pct(fraction: number, digits = 0): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

function alignPeriods(input: ForensicInput): Period[] {
  const years = new Set<number>();
  for (const statement of [...input.income, ...input.balance, ...input.cashFlow]) {
    if (typeof statement?.fiscalYear === "number") years.add(statement.fiscalYear);
  }
  const incomeByYear = new Map(input.income.map((s) => [s.fiscalYear, s]));
  const balanceByYear = new Map(input.balance.map((s) => [s.fiscalYear, s]));
  const cashFlowByYear = new Map(input.cashFlow.map((s) => [s.fiscalYear, s]));

  return [...years]
    .sort((a, b) => b - a)
    .map((fiscalYear) => ({
      fiscalYear,
      income: incomeByYear.get(fiscalYear) ?? null,
      balance: balanceByYear.get(fiscalYear) ?? null,
      cashFlow: cashFlowByYear.get(fiscalYear) ?? null,
    }));
}

function grossMargin(period: Period | undefined): number | null {
  if (!period) return null;
  return ratio(finite(period.income?.grossProfit), finite(period.income?.revenue));
}

/**
 * Descriptive forensic checks over the latest fiscal year (and its one or two predecessors).
 * Every check is independent: missing inputs skip it silently rather than flagging it, and
 * `checkedCount` reports how much of the panel the data actually supported.
 */
export function computeForensicFlags(input: ForensicInput): ForensicReport {
  const flags: ForensicFlag[] = [];
  const suppressed: ForensicSuppression[] = [];
  let checkedCount = 0;

  const periods = alignPeriods(input);
  const p0 = periods[0];
  const p1 = periods[1];
  const p2 = periods[2];
  const fy = p0 ? `FY${p0.fiscalYear}` : "the latest fiscal year";
  const sectorSuppressed = input.sector !== null && MODEL_INAPPLICABLE_SECTORS.has(input.sector);
  const suppressionReason = `not applicable to ${input.sector}`;

  // 1. Altman Z-Score (original five-ratio form).
  if (sectorSuppressed) {
    suppressed.push({ key: "altmanZ", reason: suppressionReason });
  } else {
    const totalAssets = finite(p0?.balance?.totalAssets);
    const totalLiabilities = finite(p0?.balance?.totalLiabilities);
    const currentAssets = finite(p0?.balance?.totalCurrentAssets);
    const currentLiabilities = finite(p0?.balance?.totalCurrentLiabilities);
    const retainedEarnings = finite(p0?.balance?.retainedEarnings);
    const ebit = finite(p0?.income?.operatingIncome) ?? finite(p0?.income?.ebit);
    const revenue = finite(p0?.income?.revenue);
    const marketCap = finite(input.marketCap);

    const hasInputs =
      totalAssets !== null &&
      totalAssets > 0 &&
      totalLiabilities !== null &&
      totalLiabilities > 0 &&
      currentAssets !== null &&
      currentLiabilities !== null &&
      retainedEarnings !== null &&
      ebit !== null &&
      revenue !== null &&
      marketCap !== null;

    if (hasInputs) {
      checkedCount++;
      const workingCapital = currentAssets - currentLiabilities;
      const z =
        1.2 * (workingCapital / totalAssets) +
        1.4 * (retainedEarnings / totalAssets) +
        3.3 * (ebit / totalAssets) +
        0.6 * (marketCap / totalLiabilities) +
        1.0 * (revenue / totalAssets);

      if (z <= 2.99) {
        const distress = z < 1.81;
        flags.push({
          key: "altmanZ",
          label: `Balance-sheet distress indicators (Altman Z ${z.toFixed(1)})`,
          severity: distress ? "elevated" : "noteworthy",
          detail: distress
            ? `The original five-ratio Altman Z-Score reads ${z.toFixed(1)} at ${fy}, below the model's 1.8 distress boundary. Market capitalisation stands in for market value of equity.`
            : `The original five-ratio Altman Z-Score reads ${z.toFixed(1)} at ${fy}, inside the model's 1.8–3.0 grey zone rather than its safe range.`,
          value: z,
        });
      }
    }
  }

  // 2. Accruals running ahead of cash collection.
  {
    const ni0 = finite(p0?.income?.netIncome);
    const ni1 = finite(p1?.income?.netIncome);
    const ocf0 = finite(p0?.cashFlow?.operatingCashFlow);
    const ocf1 = finite(p1?.cashFlow?.operatingCashFlow);
    const totalAssets = finite(p0?.balance?.totalAssets);

    const divergenceComputable = ni0 !== null && ni1 !== null && ocf0 !== null && ocf1 !== null;
    const accrualRatio =
      ni0 !== null && ocf0 !== null && totalAssets !== null && totalAssets > 0 ? (ni0 - ocf0) / totalAssets : null;

    if (divergenceComputable || accrualRatio !== null) {
      checkedCount++;
      const diverging = divergenceComputable && ni0! > ni1! && ocf0! < ocf1!;
      const highAccruals = accrualRatio !== null && accrualRatio > 0.1;

      if (diverging || highAccruals) {
        const details: string[] = [];
        if (diverging) {
          const niGrowth = growthRate(ni0, ni1);
          const ocfGrowth = growthRate(ocf0, ocf1);
          details.push(
            niGrowth !== null && ocfGrowth !== null
              ? `Net income rose ${pct(niGrowth)} at ${fy} while operating cash flow fell ${pct(Math.abs(ocfGrowth))}.`
              : `Net income rose at ${fy} while operating cash flow fell.`,
          );
        }
        if (highAccruals) {
          details.push(
            `Accruals — net income less operating cash flow — equal ${pct(accrualRatio!)} of total assets, above the 10% level.`,
          );
        }
        flags.push({
          key: "accrualDivergence",
          label: "Earnings running ahead of cash collection",
          severity: highAccruals ? "elevated" : "noteworthy",
          detail: details.join(" "),
          value: accrualRatio ?? undefined,
        });
      }
    }
  }

  // 3. Receivables outpacing revenue.
  {
    const receivablesGrowth = growthRate(finite(p0?.balance?.receivables), finite(p1?.balance?.receivables));
    const revenueGrowth = growthRate(finite(p0?.income?.revenue), finite(p1?.income?.revenue));

    if (receivablesGrowth !== null && revenueGrowth !== null) {
      checkedCount++;
      const gapPp = round((receivablesGrowth - revenueGrowth) * 100, 1);
      if (gapPp > 15) {
        flags.push({
          key: "receivablesVsRevenue",
          label: "Receivables growing faster than revenue",
          severity: gapPp > 30 ? "elevated" : "noteworthy",
          detail: `Receivables grew ${pct(receivablesGrowth)} at ${fy} against revenue growth of ${pct(revenueGrowth)} — a gap of ${gapPp.toFixed(0)} percentage points. More of the year's sales are still uncollected than a year ago.`,
          value: gapPp,
        });
      }
    }
  }

  // 4. Inventory build.
  {
    const inventory0 = finite(p0?.balance?.inventory);
    const inventory1 = finite(p1?.balance?.inventory);
    const carriesInventory = inventory0 !== null && inventory0 > 0 && inventory1 !== null && inventory1 > 0;
    const inventoryGrowth = carriesInventory ? growthRate(inventory0, inventory1) : null;
    const revenueGrowth = growthRate(finite(p0?.income?.revenue), finite(p1?.income?.revenue));

    if (inventoryGrowth !== null && revenueGrowth !== null) {
      checkedCount++;
      const gapPp = round((inventoryGrowth - revenueGrowth) * 100, 1);
      if (gapPp > 15) {
        flags.push({
          key: "inventoryBuild",
          label: "Inventory growing faster than revenue",
          severity: gapPp > 30 ? "elevated" : "noteworthy",
          detail: `Inventory grew ${pct(inventoryGrowth)} at ${fy} against revenue growth of ${pct(revenueGrowth)} — a gap of ${gapPp.toFixed(0)} percentage points. Stock is building faster than it is selling through.`,
          value: gapPp,
        });
      }
    }
  }

  // 5. Gross-margin erosion, off the grossProfit line — which for filers that publish no
  // GrossProfit subtotal is derived upstream as revenue - costOfRevenue (see SecEdgarProvider),
  // so this check now reaches companies whose margin was previously unmeasurable.
  {
    const gm0 = grossMargin(p0);
    const gm1 = grossMargin(p1);
    const gm2 = grossMargin(p2);

    if (gm0 !== null && gm1 !== null) {
      checkedCount++;
      // Rounded to the precision actually displayed, so a decline of exactly 300bps doesn't
      // trip a "> 300" threshold on floating-point residue alone.
      const oneYearBps = round((gm1 - gm0) * 10000, 1);
      const twoYearBps = gm2 !== null ? round((gm2 - gm0) * 10000, 1) : null;
      const trippedOneYear = oneYearBps > 300;
      const trippedTwoYear = twoYearBps !== null && twoYearBps > 500;

      if (trippedOneYear || trippedTwoYear) {
        const details: string[] = [];
        if (trippedOneYear) {
          details.push(
            `Gross margin fell from ${pct(gm1, 1)} to ${pct(gm0, 1)} at ${fy}, a ${oneYearBps.toFixed(0)} basis-point decline.`,
          );
        }
        if (trippedTwoYear) {
          details.push(`Over two fiscal years the decline is ${twoYearBps!.toFixed(0)} basis points, from ${pct(gm2!, 1)}.`);
        }
        flags.push({
          key: "grossMarginErosion",
          label: "Gross margin declining",
          severity: oneYearBps > 500 ? "elevated" : "noteworthy",
          detail: details.join(" "),
          value: trippedOneYear ? oneYearBps : twoYearBps!,
        });
      }
    }
  }

  // 6. Rising diluted share count.
  {
    const shareGrowth = growthRate(
      finite(p0?.income?.sharesOutstandingDiluted),
      finite(p1?.income?.sharesOutstandingDiluted),
    );

    if (shareGrowth !== null) {
      checkedCount++;
      const growthPct = round(shareGrowth * 100, 2);
      if (growthPct > 2) {
        flags.push({
          key: "shareCountGrowth",
          label: "Shareholders being diluted",
          severity: growthPct > 5 ? "elevated" : "noteworthy",
          detail: `Diluted shares outstanding rose ${growthPct.toFixed(1)}% at ${fy}. Per-share results carry that headwind before the business changes at all.`,
          value: growthPct,
        });
      }
    }
  }

  // 7. Composite earnings-quality index — a reduced Beneish construction.
  if (sectorSuppressed) {
    suppressed.push({ key: "earningsQualityIndex", reason: suppressionReason });
  } else {
    const revenue0 = finite(p0?.income?.revenue);
    const revenue1 = finite(p1?.income?.revenue);
    const receivables0 = finite(p0?.balance?.receivables);
    const receivables1 = finite(p1?.balance?.receivables);
    const gm0 = grossMargin(p0);
    const gm1 = grossMargin(p1);
    const leverage0 = ratio(finite(p0?.balance?.totalLiabilities), finite(p0?.balance?.totalAssets));
    const leverage1 = ratio(finite(p1?.balance?.totalLiabilities), finite(p1?.balance?.totalAssets));
    const netIncome0 = finite(p0?.income?.netIncome);
    const ocf0 = finite(p0?.cashFlow?.operatingCashFlow);
    const totalAssets0 = finite(p0?.balance?.totalAssets);

    const dsri =
      revenue0 !== null && revenue1 !== null && revenue0 > 0 && revenue1 > 0 && receivables0 !== null && receivables1 !== null && receivables1 > 0
        ? receivables0 / revenue0 / (receivables1 / revenue1)
        : null;
    const gmi = gm0 !== null && gm1 !== null && gm0 > 0 ? gm1 / gm0 : null;
    const sgi = revenue0 !== null && revenue1 !== null && revenue1 > 0 ? revenue0 / revenue1 : null;
    const lvgi = leverage0 !== null && leverage1 !== null && leverage1 > 0 ? leverage0 / leverage1 : null;
    const tata =
      netIncome0 !== null && ocf0 !== null && totalAssets0 !== null && totalAssets0 > 0
        ? (netIncome0 - ocf0) / totalAssets0
        : null;

    if (dsri !== null && gmi !== null && sgi !== null && lvgi !== null && tata !== null) {
      checkedCount++;
      // Winsorised so one exploded ratio can't carry the index on its own, and the three
      // uncomputable components (AQI, DEPI, SGAI — no depreciation or SG&A lines in this
      // dataset) enter at their neutral value of 1.0 rather than at zero, which would
      // otherwise shift the index by a constant and invalidate the published thresholds.
      const dsriW = clamp(dsri, 0.2, 5);
      const gmiW = clamp(gmi, 0.2, 5);
      const sgiW = clamp(sgi, 0.2, 5);
      const lvgiW = clamp(lvgi, 0.2, 5);
      const tataW = clamp(tata, -0.5, 0.5);
      const neutralOmittedTerms = 0.404 * 1 + 0.115 * 1 - 0.172 * 1;
      const index =
        -4.84 +
        0.92 * dsriW +
        0.528 * gmiW +
        0.892 * sgiW +
        4.679 * tataW -
        0.327 * lvgiW +
        neutralOmittedTerms;

      const elevatedComponents = [
        dsriW > 1.2 ? "receivable days" : null,
        gmiW > 1.1 ? "gross margin" : null,
        sgiW > 1.3 ? "sales growth" : null,
        tataW > 0.05 ? "total accruals" : null,
      ].filter((c): c is string => c !== null);

      // Deliberately stricter than Beneish's -1.78 screening threshold and gated on at least
      // two elevated components: the research flags this as the highest false-positive check
      // in the panel, so it only speaks when several components agree.
      if (index > -1.5 && elevatedComponents.length >= 2) {
        flags.push({
          key: "earningsQualityIndex",
          label: "Several earnings-quality components elevated together",
          severity: "noteworthy",
          detail: `A partial (5 of 8 components) Beneish-style index reads ${index.toFixed(1)} at ${fy}, with ${elevatedComponents.join(" and ")} above their neutral levels. Built from DSRI, GMI, SGI, LVGI and TATA only — the depreciation and SG&A components have no line item in this dataset — so it is a directional reading on accounting aggressiveness, not a conclusion about the company.`,
          value: index,
        });
      }
    }
  }

  const severityOrder: Record<ForensicSeverity, number> = { elevated: 0, noteworthy: 1 };
  flags.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return { flags, suppressed, checkedCount };
}
