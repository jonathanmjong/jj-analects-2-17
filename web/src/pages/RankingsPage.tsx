import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
import { Download } from "lucide-react";
import type { Company, Sector } from "@proverbs/shared";
import { SECTORS } from "@proverbs/shared";
import { useCompaniesList } from "../hooks/useCompanies";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { ScorePill } from "../components/ui/ScorePill";
import { formatCurrency } from "../lib/utils";
import { exportRowsAsCsv, exportRowsAsJson, exportRowsAsXlsx } from "../lib/exporters";

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
      <Link to={`/company/${row.original.ticker}`} className="font-medium hover:text-accent">
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
    accessorKey: "latest.overallScore",
    header: "Score",
    cell: ({ row }) => <ScorePill score={row.original.latest?.overallScore ?? null} />,
    sortingFn: (a, b) => (a.original.latest?.overallScore ?? -1) - (b.original.latest?.overallScore ?? -1),
  },
  { accessorKey: "isSp500", header: "S&P 500", cell: ({ getValue }) => (getValue<boolean>() ? "Yes" : "No") },
];

export function RankingsPage() {
  const { data: companies, isLoading } = useCompaniesList({ limitTo: 500 });
  const [globalFilter, setGlobalFilter] = useState("");
  const [sectorFilter, setSectorFilter] = useState<Sector | "all">("all");
  const [sorting, setSorting] = useState<SortingState>([{ id: "latest.overallRank", desc: false }]);
  const [visibility, setVisibility] = useState<VisibilityState>({ industry: false, "latest.sharePrice": false });

  const filteredData = useMemo(() => {
    const rows = companies ?? [];
    return sectorFilter === "all" ? rows : rows.filter((c) => c.sector === sectorFilter);
  }, [companies, sectorFilter]);

  const table = useReactTable({
    data: filteredData,
    columns,
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
          className="h-10 rounded-lg border border-border bg-surface px-3 text-sm"
        >
          <option value="all">All sectors</option>
          {SECTORS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <div className="relative">
          <details className="group">
            <summary className="flex h-10 cursor-pointer list-none items-center rounded-lg border border-border bg-surface px-3 text-sm">
              Columns
            </summary>
            <div className="absolute z-10 mt-2 w-48 rounded-lg border border-border bg-surface p-3 shadow-md">
              {table.getAllLeafColumns().map((column) => (
                <label key={column.id} className="flex items-center gap-2 py-1 text-sm">
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
          <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="cursor-pointer select-none whitespace-nowrap px-4 py-3"
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
                <td colSpan={columns.length} className="px-4 py-8 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-t border-border hover:bg-surface-muted/60">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="whitespace-nowrap px-4 py-3">
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
