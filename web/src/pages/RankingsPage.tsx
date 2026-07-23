import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { Download, SlidersHorizontal } from "lucide-react";
import type { Company, Sector } from "@proverbs/shared";
import { SECTORS } from "@proverbs/shared";
import { useCompaniesList } from "../hooks/useCompanies";
import { useAllRankings } from "../hooks/useAllRankings";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { Slider } from "../components/ui/Slider";
import { ScorePill } from "../components/ui/ScorePill";
import { formatCurrency, formatMultiple, formatPercent } from "../lib/utils";
import { exportRowsAsCsv, exportRowsAsJson, exportRowsAsXlsx } from "../lib/exporters";

interface ValueFilters {
  marketCapMinB: string;
  marketCapMaxB: string;
  maxPe: string;
  maxEvEbitda: string;
  minDividendYieldPct: string;
  minRoicPct: string;
}

const EMPTY_VALUE_FILTERS: ValueFilters = {
  marketCapMinB: "",
  marketCapMaxB: "",
  maxPe: "",
  maxEvEbitda: "",
  minDividendYieldPct: "",
  minRoicPct: "",
};

/** Count of registered valuation metrics (see functions/src/metrics/definitions.ts) — used to render "x/10" and to drive the data-availability filter slider. */
const VALUATION_METRIC_COUNT = 10;

const columns: ColumnDef<Company>[] = [
  {
    accessorKey: "latest.overallRank",
    header: "Rank",
    cell: ({ row }) => row.original.latest?.overallRank ?? "—",
    sortingFn: (a, b) => (a.original.latest?.overallRank ?? 9999) - (b.original.latest?.overallRank ?? 9999),
  },
  {
    accessorKey: "ticker",
    header: "Ticker",
    cell: ({ row }) => (
      <Link
        to={`/company/${row.original.ticker}`}
        onClick={(e) => e.stopPropagation()}
        className="font-medium hover:text-accent"
      >
        {row.original.ticker}
      </Link>
    ),
  },
  { accessorKey: "companyName", header: "Company" },
  { accessorKey: "sector", header: "Sector", cell: ({ getValue }) => getValue<string>() ?? "—" },
  { accessorKey: "industry", header: "Industry", cell: ({ getValue }) => getValue<string>() ?? "—" },
  {
    accessorKey: "latest.marketCap",
    header: "Market Cap",
    cell: ({ row }) => formatCurrency(row.original.latest?.marketCap ?? null, { compact: true }),
    sortingFn: (a, b) => (a.original.latest?.marketCap ?? 0) - (b.original.latest?.marketCap ?? 0),
  },
  {
    accessorKey: "latest.sharePrice",
    header: "Price",
    cell: ({ row }) => formatCurrency(row.original.latest?.sharePrice ?? null),
  },
  {
    id: "peTtm",
    header: "P/E",
    cell: ({ row }) => formatMultiple(row.original.latest?.headlineMetrics?.peTtm ?? null),
    sortingFn: (a, b) => (a.original.latest?.headlineMetrics?.peTtm ?? Infinity) - (b.original.latest?.headlineMetrics?.peTtm ?? Infinity),
  },
  {
    id: "roic",
    header: "ROIC",
    cell: ({ row }) => formatPercent(row.original.latest?.headlineMetrics?.roic ?? null),
    sortingFn: (a, b) => (a.original.latest?.headlineMetrics?.roic ?? -Infinity) - (b.original.latest?.headlineMetrics?.roic ?? -Infinity),
  },
  {
    id: "dividendYield",
    header: "Div. Yield",
    cell: ({ row }) => formatPercent(row.original.latest?.headlineMetrics?.dividendYield ?? null),
  },
  {
    accessorKey: "latest.overallScore",
    header: "Score",
    cell: ({ row }) => <ScorePill score={row.original.latest?.overallScore ?? null} />,
    sortingFn: (a, b) => (a.original.latest?.overallScore ?? -1) - (b.original.latest?.overallScore ?? -1),
  },
  { accessorKey: "isSp500", header: "S&P 500", cell: ({ getValue }) => (getValue<boolean>() ? "Yes" : "No") },
];

function buildValuationColumn(rankings: Map<string, import("@proverbs/shared").RankingResult> | undefined): ColumnDef<Company> {
  return {
    id: "valuationDataAvailable",
    header: "Valuation Data",
    cell: ({ row }) => {
      const count = rankings?.get(row.original.ticker)?.categoryScores.find((c) => c.category === "valuation")?.metricsIncluded ?? 0;
      return `${count}/${VALUATION_METRIC_COUNT}`;
    },
  };
}

export function RankingsPage() {
  const navigate = useNavigate();
  const { data: companies, isLoading } = useCompaniesList({ limitTo: 5000 });
  const { data: rankings } = useAllRankings();
  const [globalFilter, setGlobalFilter] = useState("");
  const [sectorFilter, setSectorFilter] = useState<Sector | "all">("all");
  const [minValuationMetrics, setMinValuationMetrics] = useState(0);
  const [valueFilters, setValueFilters] = useState<ValueFilters>(EMPTY_VALUE_FILTERS);
  const [sorting, setSorting] = useState<SortingState>([{ id: "latest.overallRank", desc: false }]);
  const [visibility, setVisibility] = useState<VisibilityState>({ industry: false, "latest.sharePrice": false });

  function valuationMetricsAvailable(ticker: string): number {
    const valuationScore = rankings?.get(ticker)?.categoryScores.find((c) => c.category === "valuation");
    return valuationScore?.metricsIncluded ?? 0;
  }

  const activeValueFilterCount = Object.values(valueFilters).filter((v) => v !== "").length;

  const filteredData = useMemo(() => {
    const rows = companies ?? [];
    const marketCapMin = valueFilters.marketCapMinB ? Number(valueFilters.marketCapMinB) * 1e9 : null;
    const marketCapMax = valueFilters.marketCapMaxB ? Number(valueFilters.marketCapMaxB) * 1e9 : null;
    const maxPe = valueFilters.maxPe ? Number(valueFilters.maxPe) : null;
    const maxEvEbitda = valueFilters.maxEvEbitda ? Number(valueFilters.maxEvEbitda) : null;
    const minDividendYield = valueFilters.minDividendYieldPct ? Number(valueFilters.minDividendYieldPct) / 100 : null;
    const minRoic = valueFilters.minRoicPct ? Number(valueFilters.minRoicPct) / 100 : null;

    return rows.filter((c) => {
      if (sectorFilter !== "all" && c.sector !== sectorFilter) return false;
      if (minValuationMetrics > 0 && valuationMetricsAvailable(c.ticker) < minValuationMetrics) return false;

      const marketCap = c.latest?.marketCap ?? null;
      if (marketCapMin !== null && (marketCap === null || marketCap < marketCapMin)) return false;
      if (marketCapMax !== null && (marketCap === null || marketCap > marketCapMax)) return false;

      const headline = c.latest?.headlineMetrics;
      if (maxPe !== null && (headline?.peTtm == null || headline.peTtm > maxPe)) return false;
      if (maxEvEbitda !== null && (headline?.evEbitda == null || headline.evEbitda > maxEvEbitda)) return false;
      if (minDividendYield !== null && (headline?.dividendYield == null || headline.dividendYield < minDividendYield)) return false;
      if (minRoic !== null && (headline?.roic == null || headline.roic < minRoic)) return false;

      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies, sectorFilter, minValuationMetrics, rankings, valueFilters]);

  const tableColumns = useMemo(() => [...columns, buildValuationColumn(rankings)], [rankings]);

  const table = useReactTable({
    data: filteredData,
    columns: tableColumns,
    state: { sorting, globalFilter, columnVisibility: visibility },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setVisibility,
    globalFilterFn: (row, _columnId, filterValue) => {
      const needle = String(filterValue).toLowerCase();
      return (
        row.original.ticker.toLowerCase().includes(needle) ||
        row.original.companyName.toLowerCase().includes(needle)
      );
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 25 } },
  });

  function exportRows(format: "csv" | "json" | "xlsx") {
    const rows = table.getFilteredRowModel().rows.map((r) => ({
      rank: r.original.latest?.overallRank,
      ticker: r.original.ticker,
      companyName: r.original.companyName,
      sector: r.original.sector,
      industry: r.original.industry,
      marketCap: r.original.latest?.marketCap,
      sharePrice: r.original.latest?.sharePrice,
      peTtm: r.original.latest?.headlineMetrics?.peTtm,
      roic: r.original.latest?.headlineMetrics?.roic,
      dividendYield: r.original.latest?.headlineMetrics?.dividendYield,
      overallScore: r.original.latest?.overallScore,
      isSp500: r.original.isSp500,
    }));
    if (format === "csv") exportRowsAsCsv(rows, "rankings.csv");
    if (format === "json") exportRowsAsJson(rows, "rankings.json");
    if (format === "xlsx") exportRowsAsXlsx(rows, "rankings.xlsx");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Rankings</h1>
        <p className="text-muted-foreground">Sort, filter, and export the full ranked universe.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search ticker or company…"
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="max-w-xs"
        />
        <select
          value={sectorFilter}
          onChange={(e) => setSectorFilter(e.target.value as Sector | "all")}
          className="h-8 rounded-md border border-border bg-surface px-2.5 text-sm"
        >
          <option value="all">All sectors</option>
          {SECTORS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <div className="flex min-w-48 items-center gap-2 text-sm">
          <span className="whitespace-nowrap text-muted-foreground">
            Min. valuation data: {minValuationMetrics}/{VALUATION_METRIC_COUNT}
          </span>
          <Slider
            min={0}
            max={VALUATION_METRIC_COUNT}
            step={1}
            value={minValuationMetrics}
            onChange={(e) => setMinValuationMetrics(Number(e.target.value))}
          />
        </div>

        <div className="relative">
          <details className="group">
            <summary className="flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-sm">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Value filters
              {activeValueFilterCount > 0 && (
                <span className="rounded-full bg-accent px-1.5 text-[11px] text-accent-foreground">{activeValueFilterCount}</span>
              )}
            </summary>
            <div className="absolute z-10 mt-2 w-64 space-y-2 rounded-md border border-border bg-surface p-3 shadow-sm">
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-muted-foreground">
                  Market cap min ($B)
                  <Input
                    type="number"
                    value={valueFilters.marketCapMinB}
                    onChange={(e) => setValueFilters((f) => ({ ...f, marketCapMinB: e.target.value }))}
                    className="mt-1"
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  Market cap max ($B)
                  <Input
                    type="number"
                    value={valueFilters.marketCapMaxB}
                    onChange={(e) => setValueFilters((f) => ({ ...f, marketCapMaxB: e.target.value }))}
                    className="mt-1"
                  />
                </label>
              </div>
              <label className="block text-xs text-muted-foreground">
                Max P/E (TTM)
                <Input
                  type="number"
                  value={valueFilters.maxPe}
                  onChange={(e) => setValueFilters((f) => ({ ...f, maxPe: e.target.value }))}
                  className="mt-1"
                />
              </label>
              <label className="block text-xs text-muted-foreground">
                Max EV/EBITDA
                <Input
                  type="number"
                  value={valueFilters.maxEvEbitda}
                  onChange={(e) => setValueFilters((f) => ({ ...f, maxEvEbitda: e.target.value }))}
                  className="mt-1"
                />
              </label>
              <label className="block text-xs text-muted-foreground">
                Min dividend yield (%)
                <Input
                  type="number"
                  value={valueFilters.minDividendYieldPct}
                  onChange={(e) => setValueFilters((f) => ({ ...f, minDividendYieldPct: e.target.value }))}
                  className="mt-1"
                />
              </label>
              <label className="block text-xs text-muted-foreground">
                Min ROIC (%)
                <Input
                  type="number"
                  value={valueFilters.minRoicPct}
                  onChange={(e) => setValueFilters((f) => ({ ...f, minRoicPct: e.target.value }))}
                  className="mt-1"
                />
              </label>
              {activeValueFilterCount > 0 && (
                <Button variant="ghost" size="sm" className="w-full" onClick={() => setValueFilters(EMPTY_VALUE_FILTERS)}>
                  Clear value filters
                </Button>
              )}
            </div>
          </details>
        </div>

        <div className="relative">
          <details className="group">
            <summary className="flex h-8 cursor-pointer list-none items-center rounded-md border border-border bg-surface px-2.5 text-sm">
              Columns
            </summary>
            <div className="absolute z-10 mt-2 w-48 rounded-md border border-border bg-surface p-2 shadow-sm">
              {table.getAllLeafColumns().map((column) => (
                <label key={column.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-surface-hover">
                  <input
                    type="checkbox"
                    checked={column.getIsVisible()}
                    onChange={column.getToggleVisibilityHandler()}
                  />
                  {column.id}
                </label>
              ))}
            </div>
          </details>
        </div>

        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => exportRows("csv")}>
            <Download className="h-4 w-4" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => exportRows("xlsx")}>
            <Download className="h-4 w-4" /> Excel
          </Button>
          <Button variant="outline" size="sm" onClick={() => exportRows("json")}>
            <Download className="h-4 w-4" /> JSON
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-card border border-border">
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="cursor-pointer select-none whitespace-nowrap border-b border-border px-3 py-2 font-medium hover:text-foreground"
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {{ asc: " ▲", desc: " ▼" }[header.column.getIsSorted() as string] ?? ""}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                onClick={() => navigate(`/company/${row.original.ticker}`)}
                className="cursor-pointer border-b border-border last:border-b-0 hover:bg-surface-hover"
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="whitespace-nowrap px-3 py-2">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount() || 1}
        </span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
            Previous
          </Button>
          <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
