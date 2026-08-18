import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { BalanceSheet, CashFlowStatement, IncomeStatement } from "@proverbs/shared";
import { HistoryLineChart } from "../charts/HistoryLineChart";
import { cn, formatPercent } from "../../lib/utils";
import {
  buildStatementRows,
  groupStatementRows,
  computeYoyChange,
  fiscalYearLabel,
  formatStatementValue,
  rowTrend,
  sparklinePoints,
  statementYears,
  STATEMENT_TABS,
  type StatementKind,
  type StatementPeriod,
  type StatementRow,
} from "./statementRows";

const TREND_GLYPH = { up: "▲", down: "▼", flat: "▬" } as const;

function RowTrendCue({ row, selected }: { row: StatementRow; selected: boolean }) {
  const trend = rowTrend(row.cells);
  const points = sparklinePoints(row.cells, 44, 12);
  return (
    <span className="flex items-center gap-1.5">
      {points ? (
        <svg
          width={44}
          height={12}
          viewBox="0 0 44 12"
          aria-hidden
          className={cn(
            "overflow-visible text-muted-foreground/40 transition-colors",
            selected ? "text-accent" : "group-hover:text-muted-foreground",
          )}
        >
          <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.25} strokeLinejoin="round" />
        </svg>
      ) : (
        trend && <span className="text-[9px] text-muted-foreground/50">{TREND_GLYPH[trend]}</span>
      )}
      <span
        className={cn(
          "text-[10px] transition-opacity",
          selected ? "text-accent opacity-100" : "text-muted-foreground opacity-0 group-hover:opacity-100",
        )}
        aria-hidden
      >
        {selected ? "▾" : "▸"}
      </span>
    </span>
  );
}

function SelectedRowChart({ row }: { row: StatementRow }) {
  const yoy = computeYoyChange(row.cells);
  const data = row.cells.map((c) => ({ periodKey: fiscalYearLabel(c.fiscalYear), value: c.value }));

  return (
    <div className="mt-4 rounded-card border border-border bg-surface-muted/40 p-3">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{row.label}</span>
        {yoy ? (
          <span className="text-xs text-muted-foreground">
            {fiscalYearLabel(yoy.from)} → {fiscalYearLabel(yoy.to)}:{" "}
            <span className={cn("font-medium", yoy.change >= 0 ? "text-positive" : "text-negative")}>
              {yoy.change >= 0 ? "+" : ""}
              {formatPercent(yoy.change)}
            </span>{" "}
            YoY
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">YoY change not meaningful (zero base or sign change)</span>
        )}
      </div>
      <HistoryLineChart
        data={data}
        label={row.label}
        formatValue={(v) => formatStatementValue(v, row.unit)}
      />
    </div>
  );
}

/** Full annual statements with TIKR-style click-a-line-to-chart-it. Rows the dataset never
 * populates are omitted rather than rendered as dash rows, so an empty row means "this company
 * doesn't report it", not "we didn't fetch it". */
export function StatementsExplorer({
  income,
  balance,
  cashFlow,
}: {
  income: IncomeStatement[];
  balance: BalanceSheet[];
  cashFlow: CashFlowStatement[];
}) {
  const [kind, setKind] = useState<StatementKind>("income");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const periods: StatementPeriod[] = useMemo(() => {
    if (kind === "balance") return balance;
    if (kind === "cashFlow") return cashFlow;
    return income;
  }, [kind, income, balance, cashFlow]);

  const rows = useMemo(
    () => buildStatementRows(periods, STATEMENT_TABS.find((t) => t.kind === kind)?.rows ?? []),
    [periods, kind],
  );
  const years = useMemo(() => statementYears(periods), [periods]);
  const selectedRow = rows.find((r) => r.key === selectedKey) ?? null;
  const groups = useMemo(() => groupStatementRows(rows), [rows]);

  /**
   * Subtotals carry their components behind a disclosure rather than every line
   * rendering at once: a statement is 12-18 rows and the subtotals are what most
   * people actually read. Collapsed by default, and reset when the tab changes so
   * a statement never opens half-expanded from a previous one.
   */
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const allOpen = groups.every((g) => g.parent === null || g.children.length === 0 || openGroups.has(g.parent.key));
  useEffect(() => setOpenGroups(new Set()), [kind]);

  function toggleGroup(key: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    setOpenGroups(allOpen ? new Set() : new Set(groups.flatMap((g) => (g.parent && g.children.length ? [g.parent.key] : []))));
  }

  function renderRow(row: StatementRow, childCount: number, isOpen: boolean) {
    const selected = row.key === selectedKey;
    return (
      <tr
        key={row.key}
        onClick={() => toggleRow(row.key)}
        className={cn(
          "group cursor-pointer border-t border-border transition-colors",
          selected ? "bg-accent/10" : "hover:bg-surface-hover",
        )}
      >
        <td
          className={cn(
            "sticky left-0 z-10 py-2 pr-4",
            selected ? "bg-surface-hover shadow-[inset_2px_0_0_0_var(--color-accent)]" : "bg-surface group-hover:bg-surface-hover",
          )}
        >
          <div className="flex items-center gap-1.5">
            {childCount > 0 ? (
              <button
                type="button"
                aria-expanded={isOpen}
                aria-label={`${isOpen ? "Hide" : "Show"} the ${childCount} line${childCount === 1 ? "" : "s"} within ${row.label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleGroup(row.key);
                }}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-surface hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-90")} />
              </button>
            ) : (
              <span className="h-5 w-5 shrink-0" aria-hidden="true" />
            )}
            {/* Row click charts the line; the chevron above is a separate control so
                expanding a subtotal never silently swaps what the chart is showing. */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleRow(row.key);
              }}
              className="flex w-full items-center justify-between gap-3 rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <span
                className={cn(
                  row.indent === 1 && "pl-3",
                  row.indent === 0 ? "font-medium" : "text-muted-foreground",
                  selected && "text-accent",
                )}
              >
                {row.label}
              </span>
              <RowTrendCue row={row} selected={selected} />
            </button>
          </div>
        </td>
        {row.cells.map((cell) => (
          <td
            key={cell.fiscalYear}
            className={cn(
              "py-2 pl-4 text-right tabular-nums",
              cell.value === null && "text-muted-foreground",
              cell.value !== null && cell.value < 0 && "text-negative",
            )}
          >
            {formatStatementValue(cell.value, row.unit)}
          </td>
        ))}
      </tr>
    );
  }


  function selectTab(next: StatementKind) {
    setKind(next);
    setSelectedKey(null);
  }

  function toggleRow(key: string) {
    setSelectedKey((current) => (current === key ? null : key));
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-md border border-border bg-surface p-0.5">
          {STATEMENT_TABS.map((tab) => (
            <button
              key={tab.kind}
              type="button"
              onClick={() => selectTab(tab.kind)}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                kind === tab.kind ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-surface-hover",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {groups.some((g) => g.parent && g.children.length > 0) && (
            <button
              type="button"
              onClick={toggleAll}
              className="rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              {allOpen ? "Collapse all" : "Expand all"}
            </button>
          )}
          <span className="text-xs text-muted-foreground">Click any line to chart its history</span>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No statement data available for this company yet.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="sticky left-0 z-10 bg-surface py-2 pr-4 font-medium">Line Item</th>
                  {years.map((year) => (
                    <th key={year} className="py-2 pl-4 text-right font-medium">
                      {fiscalYearLabel(year)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map((group, groupIndex) => {
                  const parent = group.parent;
                  const groupKey = parent?.key ?? `headless-${groupIndex}`;
                  const isOpen = parent === null || openGroups.has(parent.key);
                  return (
                    <Fragment key={groupKey}>
                      {parent && renderRow(parent, group.children.length, isOpen)}
                      {isOpen && group.children.map((child) => renderRow(child, 0, false))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {selectedRow && <SelectedRowChart row={selectedRow} />}
        </>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        Annual 10-K data via SEC EDGAR · derived fields may differ from as-reported filings
      </p>
    </div>
  );
}
