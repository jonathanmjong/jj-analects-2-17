import { describe, expect, it } from "vitest";
import {
  BALANCE_ROWS,
  buildStatementRows,
  computeYoyChange,
  fiscalYearLabel,
  formatStatementValue,
  INCOME_ROWS,
  rowTrend,
  sparklinePoints,
  statementYears,
  type StatementPeriod,
} from "./statementRows";

function incomePeriod(fiscalYear: number, fields: Record<string, number | null>): StatementPeriod {
  return { fiscalYear, ...fields } as StatementPeriod;
}

describe("row configs", () => {
  it("omits the always-null fields in this dataset", () => {
    const keys = INCOME_ROWS.map((r) => r.key);
    expect(keys).not.toContain("costOfRevenue");
    expect(keys).not.toContain("ebitda");
    expect(keys).not.toContain("eps");
    expect(BALANCE_ROWS.map((r) => r.key)).not.toContain("shortTermDebt");
  });

  it("labels totalDebt as long-term only", () => {
    expect(BALANCE_ROWS.find((r) => r.key === "totalDebt")?.label).toBe("Debt (long-term)");
  });
});

describe("statementYears", () => {
  it("returns unique fiscal years ascending regardless of input order", () => {
    expect(statementYears([{ fiscalYear: 2024 }, { fiscalYear: 2022 }, { fiscalYear: 2023 }])).toEqual([
      2022, 2023, 2024,
    ]);
  });
});

describe("buildStatementRows", () => {
  const periods = [
    incomePeriod(2024, { revenue: 300, netIncome: 30, researchAndDevelopment: null, operatingIncome: 40, ebit: 40 }),
    incomePeriod(2023, { revenue: 200, netIncome: 20, researchAndDevelopment: null, operatingIncome: 25, ebit: 25 }),
  ];

  it("orders cells by fiscal year ascending", () => {
    const revenue = buildStatementRows(periods, INCOME_ROWS).find((r) => r.key === "revenue");
    expect(revenue?.cells).toEqual([
      { fiscalYear: 2023, value: 200 },
      { fiscalYear: 2024, value: 300 },
    ]);
  });

  it("omits rows that are null in every year", () => {
    const keys = buildStatementRows(periods, INCOME_ROWS).map((r) => r.key);
    expect(keys).not.toContain("researchAndDevelopment");
    expect(keys).toContain("netIncome");
  });

  it("drops an alias row that duplicates its twin exactly", () => {
    const keys = buildStatementRows(periods, INCOME_ROWS).map((r) => r.key);
    expect(keys).toContain("operatingIncome");
    expect(keys).not.toContain("ebit");
  });

  it("keeps the alias row when the values actually differ", () => {
    const diverging = [
      incomePeriod(2024, { operatingIncome: 40, ebit: 44 }),
      incomePeriod(2023, { operatingIncome: 25, ebit: 25 }),
    ];
    expect(buildStatementRows(diverging, INCOME_ROWS).map((r) => r.key)).toContain("ebit");
  });

  it("preserves the canonical statement order", () => {
    const rows = buildStatementRows(
      [incomePeriod(2024, { netIncome: 30, revenue: 300, pretaxIncome: 35 })],
      INCOME_ROWS,
    );
    expect(rows.map((r) => r.key)).toEqual(["revenue", "pretaxIncome", "netIncome"]);
  });

  it("fills a gap year with null rather than shifting values", () => {
    const gapped = [incomePeriod(2024, { revenue: 300 }), incomePeriod(2022, { revenue: 100 })];
    const revenue = buildStatementRows(gapped, INCOME_ROWS).find((r) => r.key === "revenue");
    expect(revenue?.cells.map((c) => c.value)).toEqual([100, 300]);
  });
});

describe("formatStatementValue", () => {
  it("compacts currency", () => {
    expect(formatStatementValue(2_500_000_000, "currency")).toBe("$2.5B");
    expect(formatStatementValue(456_000_000, "currency")).toBe("$456M");
  });

  it("renders negatives with a minus sign, matching formatCurrency", () => {
    expect(formatStatementValue(-1_230_000_000, "currency")).toBe("-$1.2B");
  });

  it("renders share counts in millions", () => {
    expect(formatStatementValue(15_400_000_000, "shares")).toBe("15,400M");
  });

  it("renders per-share values at full precision", () => {
    expect(formatStatementValue(6.11, "perShare")).toBe("$6.11");
  });

  it("renders nulls as an em dash", () => {
    expect(formatStatementValue(null, "currency")).toBe("—");
  });
});

describe("fiscalYearLabel", () => {
  it("prefixes the fiscal year", () => {
    expect(fiscalYearLabel(2024)).toBe("FY2024");
  });
});

describe("computeYoyChange", () => {
  it("compares the two most recent populated years", () => {
    const yoy = computeYoyChange([
      { fiscalYear: 2022, value: 50 },
      { fiscalYear: 2023, value: 200 },
      { fiscalYear: 2024, value: 300 },
    ]);
    expect(yoy).toEqual({ from: 2023, to: 2024, change: 0.5 });
  });

  it("skips null years", () => {
    const yoy = computeYoyChange([
      { fiscalYear: 2023, value: 200 },
      { fiscalYear: 2024, value: null },
    ]);
    expect(yoy).toBeNull();
  });

  it("uses magnitude as the base when both years are negative", () => {
    const yoy = computeYoyChange([
      { fiscalYear: 2023, value: -100 },
      { fiscalYear: 2024, value: -150 },
    ]);
    expect(yoy?.change).toBeCloseTo(-0.5);
  });

  it("suppresses a sign flip rather than reporting a nonsense percentage", () => {
    expect(
      computeYoyChange([
        { fiscalYear: 2023, value: -100 },
        { fiscalYear: 2024, value: 100 },
      ]),
    ).toBeNull();
  });

  it("suppresses a zero base", () => {
    expect(
      computeYoyChange([
        { fiscalYear: 2023, value: 0 },
        { fiscalYear: 2024, value: 100 },
      ]),
    ).toBeNull();
  });
});

describe("rowTrend", () => {
  it("reports direction from first to last populated year", () => {
    expect(
      rowTrend([
        { fiscalYear: 2023, value: 10 },
        { fiscalYear: 2024, value: 20 },
      ]),
    ).toBe("up");
    expect(
      rowTrend([
        { fiscalYear: 2023, value: 20 },
        { fiscalYear: 2024, value: 10 },
      ]),
    ).toBe("down");
    expect(rowTrend([{ fiscalYear: 2024, value: 10 }])).toBeNull();
  });
});

describe("sparklinePoints", () => {
  it("normalizes into the given box, min at the bottom and max at the top", () => {
    expect(
      sparklinePoints(
        [
          { fiscalYear: 2023, value: 0 },
          { fiscalYear: 2024, value: 10 },
        ],
        40,
        10,
      ),
    ).toBe("0.0,10.0 40.0,0.0");
  });

  it("centers a flat series instead of dividing by zero", () => {
    expect(
      sparklinePoints(
        [
          { fiscalYear: 2023, value: 5 },
          { fiscalYear: 2024, value: 5 },
        ],
        40,
        10,
      ),
    ).toBe("0.0,5.0 40.0,5.0");
  });

  it("returns null when fewer than two years have data", () => {
    expect(sparklinePoints([{ fiscalYear: 2024, value: 5 }], 40, 10)).toBeNull();
  });
});
