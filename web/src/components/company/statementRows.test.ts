import { describe, expect, it } from "vitest";
import { BALANCE_ROWS, buildStatementRows, CASH_FLOW_ROWS, computeYoyChange, fiscalYearLabel, formatStatementValue, INCOME_ROWS, rowTrend, sparklinePoints, statementYears, type StatementPeriod, groupStatementRows, type StatementRow, latestFilingInfo } from "./statementRows";

function incomePeriod(fiscalYear: number, fields: Record<string, number | null>): StatementPeriod {
  return { fiscalYear, ...fields } as StatementPeriod;
}

describe("row configs", () => {
  it("omits the always-null fields in this dataset", () => {
    const keys = INCOME_ROWS.map((r) => r.key);
    expect(keys).not.toContain("ebitda");
    expect(keys).not.toContain("eps");
    expect(BALANCE_ROWS.map((r) => r.key)).not.toContain("shortTermDebt");
  });

  it("shows cost of revenue, which the SEC EDGAR provider now populates", () => {
    expect(INCOME_ROWS.map((r) => r.key)).toContain("costOfRevenue");
  });

  it("no longer labels totalDebt as long-term, since its basis varies by filer", () => {
    expect(BALANCE_ROWS.find((r) => r.key === "totalDebt")?.label).toBe("Debt");
  });

  it("shows share-based compensation as an operating-cash-flow add-back, beside D&A", () => {
    const sbc = CASH_FLOW_ROWS.find((r) => r.key === "shareBasedCompensation");
    expect(sbc?.label).toBe("Share-Based Compensation");
    expect(sbc?.unit).toBe("currency");
    // indent 1 nests it under Operating Cash Flow, which is what makes it read as an add-back
    // rather than a statement subtotal of its own.
    expect(sbc?.indent).toBe(1);
    const keys = CASH_FLOW_ROWS.map((r) => r.key);
    expect(keys.indexOf("shareBasedCompensation")).toBe(keys.indexOf("depreciationAndAmortization") + 1);
    expect(keys.indexOf("shareBasedCompensation")).toBeLessThan(keys.indexOf("freeCashFlow"));
  });
});

describe("cash flow rows — share-based compensation", () => {
  const cashFlowPeriod = (fiscalYear: number, fields: Record<string, number | null>): StatementPeriod =>
    ({ fiscalYear, ...fields }) as StatementPeriod;

  it("renders the reported figure compactly", () => {
    const rows = buildStatementRows(
      [
        cashFlowPeriod(2024, { operatingCashFlow: 118_254_000_000, shareBasedCompensation: 11_688_000_000 }),
        cashFlowPeriod(2025, { operatingCashFlow: 120_000_000_000, shareBasedCompensation: 12_863_000_000 }),
      ],
      CASH_FLOW_ROWS,
    );
    const sbc = rows.find((r) => r.key === "shareBasedCompensation");
    expect(sbc?.cells.map((c) => c.value)).toEqual([11_688_000_000, 12_863_000_000]);
    expect(formatStatementValue(sbc!.cells[1].value, sbc!.unit)).toBe("$12.9B");
  });

  it("groups under Operating Cash Flow rather than heading its own group", () => {
    const groups = groupStatementRows(
      buildStatementRows(
        [cashFlowPeriod(2025, { operatingCashFlow: 220, shareBasedCompensation: 80, freeCashFlow: 170 })],
        CASH_FLOW_ROWS,
      ),
    );
    const operating = groups.find((g) => g.parent?.key === "operatingCashFlow");
    expect(operating?.children.map((c) => c.key)).toContain("shareBasedCompensation");
  });

  it("drops the row entirely for a filer that never reports it, rather than showing zeros", () => {
    // Statements ingested before the field existed read back undefined; a filer like Exxon that
    // tags neither XBRL concept reads back null. Both must produce no row at all.
    const rows = buildStatementRows(
      [cashFlowPeriod(2025, { operatingCashFlow: 55_000_000_000, shareBasedCompensation: null }), cashFlowPeriod(2024, { operatingCashFlow: 50_000_000_000 })],
      CASH_FLOW_ROWS,
    );
    expect(rows.map((r) => r.key)).not.toContain("shareBasedCompensation");
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

describe("groupStatementRows", () => {
  const row = (key: string, indent: 0 | 1): StatementRow =>
    ({ key, label: key, indent, unit: "currency", cells: [{ fiscalYear: 2025, value: 1 }] }) as StatementRow;

  it("heads each group with its subtotal and nests the components beneath", () => {
    const groups = groupStatementRows([
      row("revenue", 0),
      row("costOfRevenue", 1),
      row("grossProfit", 0),
      row("researchAndDevelopment", 1),
    ]);
    expect(groups.map((g) => g.parent?.key)).toEqual(["revenue", "grossProfit"]);
    expect(groups[0].children.map((c) => c.key)).toEqual(["costOfRevenue"]);
    expect(groups[1].children.map((c) => c.key)).toEqual(["researchAndDevelopment"]);
  });

  it("keeps a subtotal that has no components", () => {
    const groups = groupStatementRows([row("revenue", 0), row("netIncome", 0)]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.children.length === 0)).toBe(true);
  });

  it("does not drop components that appear before any subtotal", () => {
    // Reachable when a statement's leading subtotal rows are all-null and dropped.
    const groups = groupStatementRows([row("cashAndEquivalents", 1), row("totalAssets", 0)]);
    expect(groups[0].parent).toBeNull();
    expect(groups[0].children.map((c) => c.key)).toEqual(["cashAndEquivalents"]);
    expect(groups[1].parent?.key).toBe("totalAssets");
  });

  it("loses no rows overall", () => {
    const rows = [row("a", 0), row("b", 1), row("c", 1), row("d", 0), row("e", 1)];
    const groups = groupStatementRows(rows);
    const flattened = groups.flatMap((g) => (g.parent ? [g.parent, ...g.children] : g.children));
    expect(flattened.map((r) => r.key)).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("latestFilingInfo", () => {
  it("reports the newest fiscal year's period end and filing date", () => {
    expect(
      latestFilingInfo([
        { fiscalYear: 2024, periodEnd: "2024-09-28", filedAt: "2024-11-01" },
        { fiscalYear: 2025, periodEnd: "2025-09-27", filedAt: "2025-10-31" },
      ]),
    ).toEqual({ periodEnd: "2025-09-27", filedAt: "2025-10-31" });
  });

  it("returns null rather than guessing when the newest year has no filing date", () => {
    // Documents ingested before filedAt was captured read back undefined.
    expect(latestFilingInfo([{ fiscalYear: 2025, periodEnd: "2025-09-27" }])).toBeNull();
    expect(latestFilingInfo([{ fiscalYear: 2025 }])).toBeNull();
    expect(latestFilingInfo([])).toBeNull();
  });

  it("ignores older years that do carry dates when the newest does not", () => {
    // Showing FY2019's filing date under a FY2025 table would misstate currency.
    expect(
      latestFilingInfo([
        { fiscalYear: 2019, periodEnd: "2019-12-31", filedAt: "2020-02-10" },
        { fiscalYear: 2025, periodEnd: "2025-12-31", filedAt: null },
      ]),
    ).toBeNull();
  });
});
