import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import type { Company, Sector, SentimentLabel } from "@proverbs/shared";
import { SECTORS } from "@proverbs/shared";
import { useCompaniesList } from "../hooks/useCompanies";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { ScorePill } from "../components/ui/ScorePill";
import { WatchlistButton } from "../components/ui/WatchlistButton";
import { cn } from "../lib/utils";

const LABEL_FILTERS: Array<{ value: SentimentLabel | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "positive", label: "Positive" },
  { value: "neutral", label: "Neutral" },
  { value: "negative", label: "Negative" },
];

function labelBadgeVariant(label: SentimentLabel): "positive" | "negative" | "neutral" {
  if (label === "positive") return "positive";
  if (label === "negative") return "negative";
  return "neutral";
}

const columns: ColumnDef<Company>[] = [
  {
    id: "sentimentRank",
    header: "#",
    cell: ({ row }) => row.index + 1,
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
  {
    id: "label",
    header: "Sentiment",
    cell: ({ row }) => {
      const s = row.original.latest?.sentiment;
      if (!s) return <span className="text-muted-foreground">—</span>;
      return (
        <Badge variant={labelBadgeVariant(s.label)} className="capitalize">
          {s.label}
        </Badge>
      );
    },
  },
  {
    id: "score",
    header: "Score",
    cell: ({ row }) => <ScorePill score={row.original.latest?.sentiment?.score ?? null} />,
    sortingFn: (a, b) => (a.original.latest?.sentiment?.score ?? -1) - (b.original.latest?.sentiment?.score ?? -1),
  },
  {
    id: "articles",
    header: "Articles",
    cell: ({ row }) => row.original.latest?.sentiment?.articleCount ?? "—",
  },
  {
    id: "watchlist",
    header: "",
    cell: ({ row }) => <WatchlistButton ticker={row.original.ticker} />,
  },
];

export function SentimentPage() {
  const navigate = useNavigate();
  const { data: companies, isLoading } = useCompaniesList({ limitTo: 5000 });
  const [globalFilter, setGlobalFilter] = useState("");
  const [sectorFilter, setSectorFilter] = useState<Set<Sector>>(new Set());
  const [labelFilter, setLabelFilter] = useState<SentimentLabel | "all">("all");
  const [sorting, setSorting] = useState<SortingState>([{ id: "score", desc: true }]);

  function toggleSector(sector: Sector) {
    setSectorFilter((prev) => {
      const next = new Set(prev);
      if (next.has(sector)) next.delete(sector);
      else next.add(sector);
      return next;
    });
  }

  const { ranked, withoutData } = useMemo(() => {
    const rows = companies ?? [];
    const withSentiment = rows.filter((c) => c.latest?.sentiment != null);
    const filtered = withSentiment.filter((c) => {
      if (sectorFilter.size > 0 && (!c.sector || !sectorFilter.has(c.sector))) return false;
      if (labelFilter !== "all" && c.latest?.sentiment?.label !== labelFilter) return false;
      if (globalFilter) {
        const needle = globalFilter.toLowerCase();
        if (!c.ticker.toLowerCase().includes(needle) && !c.companyName.toLowerCase().includes(needle)) return false;
      }
      return true;
    });
    filtered.sort((a, b) => (b.latest?.sentiment?.score ?? 0) - (a.latest?.sentiment?.score ?? 0));
    return { ranked: filtered, withoutData: rows.length - withSentiment.length };
  }, [companies, sectorFilter, labelFilter, globalFilter]);

  const table = useReactTable({
    data: ranked,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 25 } },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sentiment</h1>
        <p className="text-sm text-muted-foreground">
          Companies ranked by recent news sentiment — scored from headline text via a finance-tuned word lexicon
          (positive/negative term matching with basic negation handling), not an AI/ML model. Treat it as a
          directional signal, not a precise measurement.
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Input
              placeholder="Search ticker or company…"
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              className="max-w-xs"
            />

            <div className="flex gap-1 rounded-md border border-border bg-surface p-0.5">
              {LABEL_FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setLabelFilter(f.value)}
                  className={cn(
                    "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                    labelFilter === f.value ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-surface-hover",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="relative">
              <details className="group">
                <summary className="flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-sm">
                  {sectorFilter.size === 0 ? "All sectors" : `Sectors (${sectorFilter.size})`}
                </summary>
                <div className="absolute z-10 mt-2 max-h-72 w-56 space-y-1 overflow-y-auto rounded-md border border-border bg-surface p-3 shadow-sm">
                  {SECTORS.map((s) => (
                    <label key={s} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={sectorFilter.has(s)} onChange={() => toggleSector(s)} />
                      {s}
                    </label>
                  ))}
                  {sectorFilter.size > 0 && (
                    <Button variant="ghost" size="sm" className="w-full" onClick={() => setSectorFilter(new Set())}>
                      Clear sectors
                    </Button>
                  )}
                </div>
              </details>
            </div>

            <span className="ml-auto text-xs text-muted-foreground">
              {ranked.length} ranked
              {withoutData > 0 && ` · ${withoutData} not yet scored`}
            </span>
          </div>

          <div className="overflow-x-auto rounded-card border border-border">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-surface-muted text-left text-xs uppercase text-muted-foreground">
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((header) => (
                      <th
                        key={header.id}
                        className={cn("px-3 py-2 font-medium", header.column.getCanSort() && "cursor-pointer select-none")}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {{ asc: " ↑", desc: " ↓" }[header.column.getIsSorted() as string] ?? ""}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-hover"
                    onClick={() => navigate(`/company/${row.original.ticker}`)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-3 py-2">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
                {ranked.length === 0 && (
                  <tr>
                    <td colSpan={columns.length} className="px-3 py-8 text-center text-muted-foreground">
                      No companies match the current filters.
                    </td>
                  </tr>
                )}
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
        </>
      )}
    </div>
  );
}
