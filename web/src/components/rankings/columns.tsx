import type { ColumnDef } from "@tanstack/react-table";
import type { Company } from "@proverbs/shared";
import { compareNegativeIsBad } from "@proverbs/shared";
import { ScorePill } from "../ui/ScorePill";
import { WatchlistButton } from "../ui/WatchlistButton";
import { TickerHoverLink } from "./TickerHoverLink";
import { formatCurrency, formatMultiple, formatPercent } from "../../lib/utils";

/**
 * Exported for the id-consistency test. TanStack derives a column's id from
 * `accessorKey` by replacing dots with underscores, so `latest.overallRank`
 * silently became `latest_overallRank` and the default sort referenced a
 * column that did not exist — it only looked sorted because rows arrive in
 * rank order. Every dotted column now carries an explicit id.
 */
export const columns: ColumnDef<Company>[] = [
  {
    id: "watchlist",
    header: "",
    cell: ({ row }) => <WatchlistButton ticker={row.original.ticker} />,
    enableSorting: false,
  },
  {
    id: "overallRank",
    accessorKey: "latest.overallRank",
    header: "Rank",
    cell: ({ row }) => row.original.latest?.overallRank ?? "—",
    sortingFn: (a, b) => (a.original.latest?.overallRank ?? 9999) - (b.original.latest?.overallRank ?? 9999),
  },
  {
    accessorKey: "ticker",
    header: "Ticker",
    cell: ({ row }) => <TickerHoverLink company={row.original} />,
  },
  { accessorKey: "companyName", header: "Company" },
  { accessorKey: "sector", header: "Sector", cell: ({ getValue }) => getValue<string>() ?? "—" },
  { accessorKey: "industry", header: "Industry", cell: ({ getValue }) => getValue<string>() ?? "—" },
  { accessorKey: "country", header: "Country", cell: ({ getValue }) => getValue<string>() ?? "—" },
  {
    id: "marketCap",
    accessorKey: "latest.marketCap",
    header: "Market Cap",
    cell: ({ row }) => formatCurrency(row.original.latest?.marketCap ?? null, { compact: true }),
    sortingFn: (a, b) => (a.original.latest?.marketCap ?? 0) - (b.original.latest?.marketCap ?? 0),
  },
  {
    id: "sharePrice",
    accessorKey: "latest.sharePrice",
    header: "Price",
    cell: ({ row }) => {
      const latest = row.original.latest;
      const formatted = formatCurrency(latest?.sharePrice ?? null);
      if (latest?.priceSource !== "sec_public_float") return formatted;
      return (
        <span
          className="cursor-help underline decoration-dotted decoration-muted-foreground/50"
          title={`Approximate — no live quote available, derived from SEC EDGAR's most recent filing (as of ${latest.asOf}), not a current market price.`}
        >
          ~{formatted}
        </span>
      );
    },
  },
  {
    id: "peTtm",
    header: "P/E",
    cell: ({ row }) => formatMultiple(row.original.latest?.headlineMetrics?.peTtm ?? null),
    sortingFn: (a, b) =>
      compareNegativeIsBad(a.original.latest?.headlineMetrics?.peTtm, b.original.latest?.headlineMetrics?.peTtm),
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
    id: "overallScore",
    accessorKey: "latest.overallScore",
    header: "Score",
    cell: ({ row }) => <ScorePill score={row.original.latest?.overallScore ?? null} />,
    sortingFn: (a, b) => (a.original.latest?.overallScore ?? -1) - (b.original.latest?.overallScore ?? -1),
  },
  { accessorKey: "isSp500", header: "S&P 500", cell: ({ getValue }) => (getValue<boolean>() ? "Yes" : "No") },
];

