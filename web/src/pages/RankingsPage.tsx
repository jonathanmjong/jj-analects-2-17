import { useEffect, useMemo, useRef, useState } from "react";
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
import { Download, HelpCircle, SlidersHorizontal } from "lucide-react";
import type { Company, MetricCategory, Sector } from "@proverbs/shared";
import { DEFAULT_RANKING_CONFIG, METRIC_CATEGORIES, SECTORS } from "@proverbs/shared";
import { useCompaniesList } from "../hooks/useCompanies";
import { useAllRankings } from "../hooks/useAllRankings";
import { useCustomRankings } from "../hooks/useCustomRankings";
import { useMetricDefinitions } from "../hooks/useMetricDefinitions";
import { usePageState } from "../hooks/usePageState";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { Slider } from "../components/ui/Slider";
import { ScorePill } from "../components/ui/ScorePill";
import { WatchlistButton } from "../components/ui/WatchlistButton";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";
import { QualityGrowthScatter, type ScatterDatum } from "../components/charts/QualityGrowthScatter";
import { formatCurrency, formatMultiple, formatPercent } from "../lib/utils";
import { exportRowsAsCsv, exportRowsAsJson, exportRowsAsXlsx } from "../lib/exporters";
import { evaluateFormula, FormulaError, parseFormula, type FormulaContext } from "../lib/formulaFilter";

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


const CATEGORY_LABELS: Record<MetricCategory, string> = {
  valuation: "Valuation",
  momentum: "Momentum",
  profitability: "Profitability",
  growth: "Growth",
  cashGeneration: "Cash Generation",
  financialStrength: "Financial Strength",
  capitalAllocation: "Capital Allocation",
  efficiency: "Efficiency",
  earningsQuality: "Earnings Quality",
  moat: "Competitive Moat",
};

const FORMULA_FIELD_INFO: Array<{ field: string; description: string; example: string }> = [
  { field: "marketCap", description: "Market capitalization", example: "marketCap > 10B" },
  { field: "roic", description: "Return on invested capital", example: "roic > 15%" },
  { field: "peTtm", description: "Price / earnings (trailing 12mo)", example: "peTtm < 20" },
  { field: "evEbitda", description: "Enterprise value / EBITDA", example: "evEbitda < 15" },
  { field: "dividendYield", description: "Dividend yield", example: "dividendYield > 2%" },
  { field: "fcfYield", description: "Free cash flow yield", example: "fcfYield > 5%" },
  { field: "revenueGrowth1y", description: "1-year revenue growth", example: "revenueGrowth1y > 10%" },
  { field: "overallScore", description: "Overall ranking score (0-100)", example: "overallScore > 70" },
];

const FORMULA_EXAMPLES = [
  "roic > 15% AND peTtm < 20",
  "marketCap > 10B AND dividendYield > 2%",
  "overallScore > 70 AND evEbitda < 15",
  "(roic > 12% OR fcfYield > 5%) AND revenueGrowth1y > 0%",
  "NOT (peTtm > 30)",
];

const columns: ColumnDef<Company>[] = [
  {
    id: "watchlist",
    header: "",
    cell: ({ row }) => <WatchlistButton ticker={row.original.ticker} />,
    enableSorting: false,
  },
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
  { accessorKey: "country", header: "Country", cell: ({ getValue }) => getValue<string>() ?? "—" },
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

function buildCategoryDataColumn(
  rankings: Map<string, import("@proverbs/shared").RankingResult> | undefined,
  activeCategories: MetricCategory[],
  denominator: number,
): ColumnDef<Company> {
  return {
    id: "categoryWeightDataAvailable",
    header: "Category Data",
    cell: ({ row }) => {
      const scores = rankings?.get(row.original.ticker)?.categoryScores ?? [];
      const count = scores
        .filter((c) => activeCategories.includes(c.category))
        .reduce((sum, c) => sum + c.metricsIncluded, 0);
      return `${count}/${denominator}`;
    },
  };
}

export function RankingsPage() {
  const navigate = useNavigate();
  const { data: companies, isLoading } = useCompaniesList({ limitTo: 5000 });
  const { data: rankings } = useAllRankings();
  const { data: metricDefinitions } = useMetricDefinitions();
  const {
    results: customResults,
    loading: recomputing,
    error: recomputeError,
    setMetricWeight,
    resetMetricWeights,
    setCategoryWeight,
    setYearsIncluded,
    setConfig,
    recompute,
    config: customConfig,
  } = useCustomRankings("rankings.customConfig");
  const yearsIncluded = customConfig.yearsIncluded;
  const [metricWeightInputs, setMetricWeightInputs] = usePageState<Record<string, number>>("rankings.metricWeightInputs", {});
  const recomputeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [globalFilter, setGlobalFilter] = usePageState("rankings.globalFilter", "");
  /** Empty set means "no filter" (all sectors/countries shown), matching the old "all" option. */
  const [sectorFilter, setSectorFilter] = usePageState<Set<Sector>>("rankings.sectorFilter", () => new Set());
  const [countryFilter, setCountryFilter] = usePageState<Set<string>>("rankings.countryFilter", () => new Set());

  function toggleSector(sector: Sector) {
    setSectorFilter((prev) => {
      const next = new Set(prev);
      if (next.has(sector)) next.delete(sector);
      else next.add(sector);
      return next;
    });
  }

  function toggleCountry(country: string) {
    setCountryFilter((prev) => {
      const next = new Set(prev);
      if (next.has(country)) next.delete(country);
      else next.add(country);
      return next;
    });
  }
  const [minCategoryWeightMetrics, setMinCategoryWeightMetrics] = usePageState("rankings.minCategoryWeightMetrics", 0);
  const [valueFilters, setValueFilters] = usePageState<ValueFilters>("rankings.valueFilters", EMPTY_VALUE_FILTERS);
  const [formulaInput, setFormulaInput] = usePageState("rankings.formulaInput", "");
  const [formulaHelpOpen, setFormulaHelpOpen] = useState(false);
  const [sorting, setSorting] = usePageState<SortingState>("rankings.sorting", () => [{ id: "latest.overallRank", desc: false }]);
  const [visibility, setVisibility] = usePageState<VisibilityState>("rankings.visibility", {
    industry: false,
    "latest.sharePrice": false,
    country: false,
  });

  /** Ticker -> live reranked result, once a category/metric-weight or years-of-data change has recomputed. Null until the first recompute finishes. */
  const customOverrideByTicker = useMemo(() => {
    if (!customResults) return null;
    return new Map(customResults.map((r) => [r.ticker, r]));
  }, [customResults]);

  /** Categories the user currently has a nonzero weight on, per the Category weights panel. */
  const activeCategories = useMemo(
    () => METRIC_CATEGORIES.filter((c) => (customConfig.categoryWeights[c] ?? 0) > 0),
    [customConfig.categoryWeights],
  );

  const activeCategoryMetricCount = useMemo(
    () => (metricDefinitions ?? []).filter((m) => activeCategories.includes(m.category)).length,
    [metricDefinitions, activeCategories],
  );

  // Default the "min. category weight data" slider to 60% (rounded up) of
  // the denominator once metric definitions have loaded — can't compute this
  // until then since the denominator is 0 pre-load. Only applies the default
  // once ever per session (persisted, since minCategoryWeightMetrics itself
  // now survives remounts too — otherwise returning to this page would
  // silently re-run the default and clobber a value the user picked).
  const [hasSetDefaultMin, setHasSetDefaultMin] = usePageState("rankings.minCategoryDefaultApplied", false);
  useEffect(() => {
    if (!hasSetDefaultMin && activeCategoryMetricCount > 0) {
      setHasSetDefaultMin(true);
      setMinCategoryWeightMetrics(Math.ceil(activeCategoryMetricCount * 0.6));
    }
  }, [activeCategoryMetricCount, hasSetDefaultMin, setHasSetDefaultMin, setMinCategoryWeightMetrics]);

  function categoryWeightDataAvailable(ticker: string): number {
    // Prefer the live reranked result when one exists — zeroing out a metric's weight in the
    // Valuation weights panel excludes it (counted as missing), which a stale nightly snapshot won't reflect.
    const scores = customOverrideByTicker?.get(ticker)?.categoryScores ?? rankings?.get(ticker)?.categoryScores ?? [];
    return scores
      .filter((c) => activeCategories.includes(c.category))
      .reduce((sum, c) => sum + c.metricsIncluded, 0);
  }

  const activeValueFilterCount = Object.values(valueFilters).filter((v) => v !== "").length;

  const countries = useMemo(() => {
    const set = new Set<string>();
    for (const c of companies ?? []) {
      if (c.country) set.add(c.country);
    }
    return [...set].sort();
  }, [companies]);

  const valuationMetrics = useMemo(
    () => (metricDefinitions ?? []).filter((m) => m.category === "valuation"),
    [metricDefinitions],
  );

  function weightFor(metricKey: string): number {
    return metricWeightInputs[metricKey] ?? 1;
  }

  function handleMetricWeightChange(metricKey: string, weight: number) {
    setMetricWeightInputs((prev) => ({ ...prev, [metricKey]: weight }));
    const nextConfig = setMetricWeight(metricKey, weight);
    if (recomputeTimer.current) clearTimeout(recomputeTimer.current);
    recomputeTimer.current = setTimeout(() => void recompute(nextConfig), 60);
  }

  function handleYearsChange(value: number) {
    const nextConfig = setYearsIncluded(value as 1 | 2 | 3 | 4 | 5);
    if (recomputeTimer.current) clearTimeout(recomputeTimer.current);
    recomputeTimer.current = setTimeout(() => void recompute(nextConfig), 60);
  }

  function handleResetMetricWeights() {
    setMetricWeightInputs({});
    const nextConfig = resetMetricWeights();
    if (recomputeTimer.current) clearTimeout(recomputeTimer.current);
    void recompute(nextConfig);
  }

  /** Slider value is a 0-100 percent; stored/sent as a 0-1 weight, renormalized against the other categories server-side (doesn't need to sum to 100). */
  function handleCategoryWeightChange(category: MetricCategory, percent: number) {
    const nextConfig = setCategoryWeight(category, percent / 100);
    if (recomputeTimer.current) clearTimeout(recomputeTimer.current);
    recomputeTimer.current = setTimeout(() => void recompute(nextConfig), 60);
  }

  function handleResetCategoryWeights() {
    const nextConfig = { ...customConfig, categoryWeights: DEFAULT_RANKING_CONFIG.categoryWeights };
    setConfig(nextConfig);
    if (recomputeTimer.current) clearTimeout(recomputeTimer.current);
    void recompute(nextConfig);
  }

  const categoryWeightsActive = METRIC_CATEGORIES.some(
    (c) => customConfig.categoryWeights[c] !== DEFAULT_RANKING_CONFIG.categoryWeights[c],
  );

  useEffect(() => {
    return () => {
      if (recomputeTimer.current) clearTimeout(recomputeTimer.current);
    };
  }, []);

  const metricWeightsActive = Object.keys(customConfig.metricWeights ?? {}).length > 0;

  const { formulaNode, formulaError } = useMemo(() => {
    if (!formulaInput.trim()) return { formulaNode: null, formulaError: null };
    try {
      return { formulaNode: parseFormula(formulaInput), formulaError: null };
    } catch (e) {
      return { formulaNode: null, formulaError: e instanceof FormulaError ? e.message : "Invalid formula" };
    }
  }, [formulaInput]);

  const filteredData = useMemo(() => {
    const rows = companies ?? [];
    const marketCapMin = valueFilters.marketCapMinB ? Number(valueFilters.marketCapMinB) * 1e9 : null;
    const marketCapMax = valueFilters.marketCapMaxB ? Number(valueFilters.marketCapMaxB) * 1e9 : null;
    const maxPe = valueFilters.maxPe ? Number(valueFilters.maxPe) : null;
    const maxEvEbitda = valueFilters.maxEvEbitda ? Number(valueFilters.maxEvEbitda) : null;
    const minDividendYield = valueFilters.minDividendYieldPct ? Number(valueFilters.minDividendYieldPct) / 100 : null;
    const minRoic = valueFilters.minRoicPct ? Number(valueFilters.minRoicPct) / 100 : null;

    return rows.filter((c) => {
      if (sectorFilter.size > 0 && (!c.sector || !sectorFilter.has(c.sector))) return false;
      if (countryFilter.size > 0 && (!c.country || !countryFilter.has(c.country))) return false;
      if (minCategoryWeightMetrics > 0 && categoryWeightDataAvailable(c.ticker) < minCategoryWeightMetrics) return false;

      const marketCap = c.latest?.marketCap ?? null;
      if (marketCapMin !== null && (marketCap === null || marketCap < marketCapMin)) return false;
      if (marketCapMax !== null && (marketCap === null || marketCap > marketCapMax)) return false;

      const headline = c.latest?.headlineMetrics;
      if (maxPe !== null && (headline?.peTtm == null || headline.peTtm > maxPe)) return false;
      if (maxEvEbitda !== null && (headline?.evEbitda == null || headline.evEbitda > maxEvEbitda)) return false;
      if (minDividendYield !== null && (headline?.dividendYield == null || headline.dividendYield < minDividendYield)) return false;
      if (minRoic !== null && (headline?.roic == null || headline.roic < minRoic)) return false;

      if (formulaNode) {
        const context: FormulaContext = {
          marketcap: marketCap,
          roic: headline?.roic ?? null,
          pettm: headline?.peTtm ?? null,
          evebitda: headline?.evEbitda ?? null,
          dividendyield: headline?.dividendYield ?? null,
          fcfyield: headline?.fcfYield ?? null,
          revenuegrowth1y: headline?.revenueGrowth1y ?? null,
          overallscore: customOverrideByTicker?.get(c.ticker)?.overallScore ?? c.latest?.overallScore ?? null,
        };
        if (!evaluateFormula(formulaNode, context)) return false;
      }

      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies, sectorFilter, countryFilter, minCategoryWeightMetrics, activeCategories, rankings, valueFilters, formulaNode, customOverrideByTicker]);

  const displayData = useMemo(() => {
    if (!customOverrideByTicker) return filteredData;
    return filteredData.map((c) => {
      const override = customOverrideByTicker.get(c.ticker);
      if (!override || !c.latest) return c;
      return {
        ...c,
        latest: { ...c.latest, overallScore: override.overallScore, overallRank: override.overallRank },
      };
    });
  }, [filteredData, customOverrideByTicker]);

  const tableColumns = useMemo(
    () => [...columns, buildCategoryDataColumn(rankings, activeCategories, activeCategoryMetricCount)],
    [rankings, activeCategories, activeCategoryMetricCount],
  );

  const scatterCandidates = useMemo<ScatterDatum[]>(() => {
    return filteredData
      .filter(
        (c): c is typeof c & { latest: { marketCap: number; headlineMetrics: { roic: number; revenueGrowth1y: number } } } =>
          c.latest?.marketCap != null &&
          c.latest?.headlineMetrics?.roic != null &&
          c.latest?.headlineMetrics?.revenueGrowth1y != null &&
          c.sector != null,
      )
      .sort((a, b) => b.latest.marketCap - a.latest.marketCap)
      .slice(0, 200)
      .map((c) => ({
        ticker: c.ticker,
        companyName: c.companyName,
        sector: c.sector as string,
        roic: c.latest.headlineMetrics.roic,
        revenueGrowth1y: c.latest.headlineMetrics.revenueGrowth1y,
        marketCap: c.latest.marketCap,
      }));
  }, [filteredData]);

  /** 0 = no trimming (matches the old, always-on behavior). Otherwise excludes the most extreme
   * X% of each tail on ROIC or revenue growth so a handful of extreme values don't compress the
   * rest of the plot into a corner. */
  const [outlierTrimPct, setOutlierTrimPct] = usePageState("rankings.outlierTrimPct", 0);
  const [outlierPanelOpen, setOutlierPanelOpen] = useState(false);

  const { scatterData, excludedOutliers } = useMemo(() => {
    if (outlierTrimPct <= 0 || scatterCandidates.length < 10) {
      return { scatterData: scatterCandidates, excludedOutliers: [] as ScatterDatum[] };
    }
    const frac = outlierTrimPct / 100;
    const percentileValue = (sorted: number[], pct: number) =>
      sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(pct * (sorted.length - 1))))];
    const roicSorted = scatterCandidates.map((c) => c.roic).sort((a, b) => a - b);
    const growthSorted = scatterCandidates.map((c) => c.revenueGrowth1y).sort((a, b) => a - b);
    const roicLow = percentileValue(roicSorted, frac);
    const roicHigh = percentileValue(roicSorted, 1 - frac);
    const growthLow = percentileValue(growthSorted, frac);
    const growthHigh = percentileValue(growthSorted, 1 - frac);

    const kept: ScatterDatum[] = [];
    const excluded: ScatterDatum[] = [];
    for (const c of scatterCandidates) {
      const isOutlier = c.roic < roicLow || c.roic > roicHigh || c.revenueGrowth1y < growthLow || c.revenueGrowth1y > growthHigh;
      (isOutlier ? excluded : kept).push(c);
    }
    return { scatterData: kept, excludedOutliers: excluded };
  }, [scatterCandidates, outlierTrimPct]);

  const table = useReactTable({
    data: displayData,
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
      country: r.original.country,
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
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Rankings</h1>
        <p className="text-sm text-muted-foreground">Sort, filter, and export the full ranked universe.</p>
      </div>

      {scatterCandidates.length > 1 && (
        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Quality vs. Growth (ROIC × Revenue Growth, sized by market cap)</CardTitle>
            <div className="flex items-center gap-3 text-xs">
              <span className="whitespace-nowrap text-muted-foreground">Trim outliers: {outlierTrimPct}%</span>
              <Slider
                min={0}
                max={10}
                step={0.5}
                value={outlierTrimPct}
                onChange={(e) => setOutlierTrimPct(Number(e.target.value))}
                className="w-28"
              />
              {excludedOutliers.length > 0 && (
                <div
                  className="relative"
                  onMouseEnter={() => setOutlierPanelOpen(true)}
                  onMouseLeave={() => setOutlierPanelOpen(false)}
                >
                  <span className="cursor-default whitespace-nowrap rounded-full border border-border bg-surface-muted px-2 py-0.5 text-muted-foreground">
                    {excludedOutliers.length} removed
                  </span>
                  {outlierPanelOpen && (
                    <div className="absolute right-0 z-20 mt-1 max-h-64 w-64 overflow-y-auto rounded-md border border-border bg-surface p-2 shadow-md">
                      <p className="mb-1 px-1 text-[11px] font-semibold text-foreground">Removed as outliers</p>
                      <ul className="space-y-0.5">
                        {excludedOutliers.map((c) => (
                          <li key={c.ticker} className="flex items-center justify-between gap-2 rounded px-1 py-0.5 hover:bg-surface-hover">
                            <span className="font-mono text-accent">{c.ticker}</span>
                            <span className="truncate text-muted-foreground">{c.companyName}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {scatterData.length > 0 ? (
              <>
                <QualityGrowthScatter data={scatterData} onSelect={(ticker) => navigate(`/company/${ticker}`)} />
                <p className="mt-2 text-xs text-muted-foreground">
                  Largest {scatterData.length} companies (by market cap) matching the current filters with both
                  metrics available. Colored by sector.
                </p>
              </>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                The outlier trim removed every company in the current filter — lower the trim percentage above to see
                the chart again.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {recomputeError && (
        <div className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">
          Failed to recompute rankings with your custom weights: {recomputeError} — showing the last known
          scores/ranks instead.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search ticker or company…"
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="max-w-xs"
        />
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

        <div className="relative">
          <details className="group">
            <summary className="flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-sm">
              {countryFilter.size === 0 ? "All countries" : `Countries (${countryFilter.size})`}
            </summary>
            <div className="absolute z-10 mt-2 max-h-72 w-56 space-y-1 overflow-y-auto rounded-md border border-border bg-surface p-3 shadow-sm">
              {countries.map((c) => (
                <label key={c} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={countryFilter.has(c)} onChange={() => toggleCountry(c)} />
                  {c}
                </label>
              ))}
              {countryFilter.size > 0 && (
                <Button variant="ghost" size="sm" className="w-full" onClick={() => setCountryFilter(new Set())}>
                  Clear countries
                </Button>
              )}
            </div>
          </details>
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
            <summary className="flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-sm">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Valuation weights
              {metricWeightsActive && (
                <span className="rounded-full bg-accent px-1.5 text-[11px] text-accent-foreground">on</span>
              )}
              {recomputing && <span className="text-[11px] text-muted-foreground">recomputing…</span>}
            </summary>
            <div className="absolute z-10 mt-2 w-72 space-y-2 rounded-md border border-border bg-surface p-3 shadow-sm">
              <p className="text-xs text-muted-foreground">
                Weight each valuation metric's contribution to the Valuation category score (0 = excluded, 100% =
                default, up to 200% = double weight). Overall score and rank update live for the whole universe.
              </p>
              {valuationMetrics.length === 0 && <p className="text-xs text-muted-foreground">Loading metrics…</p>}
              {valuationMetrics.map((metric) => (
                <label key={metric.key} className="block text-xs text-muted-foreground">
                  <div className="flex items-center justify-between">
                    <span>{metric.label}</span>
                    <span>{Math.round(weightFor(metric.key) * 100)}%</span>
                  </div>
                  <Slider
                    min={0}
                    max={2}
                    step={0.1}
                    value={weightFor(metric.key)}
                    onChange={(e) => handleMetricWeightChange(metric.key, Number(e.target.value))}
                    className="mt-1"
                  />
                </label>
              ))}
              {metricWeightsActive && (
                <Button variant="ghost" size="sm" className="w-full" onClick={handleResetMetricWeights}>
                  Reset valuation weights
                </Button>
              )}
            </div>
          </details>
        </div>

        <div className="relative">
          <details className="group">
            <summary className="flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-sm">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Category weights
              {categoryWeightsActive && (
                <span className="rounded-full bg-accent px-1.5 text-[11px] text-accent-foreground">on</span>
              )}
              {recomputing && <span className="text-[11px] text-muted-foreground">recomputing…</span>}
            </summary>
            <div className="absolute z-10 mt-2 w-72 space-y-2 rounded-md border border-border bg-surface p-3 shadow-sm">
              <p className="text-xs text-muted-foreground">
                Reweight how much each category contributes to the overall score. Values don't need to sum to
                100% — they're renormalized against each other. Overall score and rank update live for the whole
                universe.
              </p>
              {METRIC_CATEGORIES.map((category) => (
                <label key={category} className="block text-xs text-muted-foreground">
                  <div className="flex items-center justify-between">
                    <span>{CATEGORY_LABELS[category]}</span>
                    <span>{Math.round((customConfig.categoryWeights[category] ?? 0) * 100)}%</span>
                  </div>
                  <Slider
                    min={0}
                    max={100}
                    step={1}
                    value={(customConfig.categoryWeights[category] ?? 0) * 100}
                    onChange={(e) => handleCategoryWeightChange(category, Number(e.target.value))}
                    className="mt-1"
                  />
                </label>
              ))}
              {categoryWeightsActive && (
                <Button variant="ghost" size="sm" className="w-full" onClick={handleResetCategoryWeights}>
                  Reset category weights
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

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-8 min-w-48 flex-nowrap items-center gap-2 text-sm">
          <span className="whitespace-nowrap text-muted-foreground">
            Years of data: {yearsIncluded} {recomputing && "· recomputing…"}
          </span>
          <Slider
            min={1}
            max={5}
            step={1}
            value={yearsIncluded}
            onChange={(e) => handleYearsChange(Number(e.target.value))}
            className="shrink-0"
          />
        </div>

        <div className="flex h-8 min-w-48 flex-nowrap items-center gap-2 text-sm">
          <span className="whitespace-nowrap text-muted-foreground">
            Min. category weight data: {minCategoryWeightMetrics}/{activeCategoryMetricCount}
          </span>
          <Slider
            min={0}
            max={activeCategoryMetricCount}
            step={1}
            value={minCategoryWeightMetrics}
            onChange={(e) => setMinCategoryWeightMetrics(Number(e.target.value))}
            className="shrink-0"
          />
        </div>
      </div>

      <div className="relative">
        <div className="flex items-center gap-2">
          <div className="relative max-w-xl flex-1">
            <Input
              placeholder='Custom formula, e.g. "roic > 15% AND peTtm < 20 AND marketCap > 5B"'
              value={formulaInput}
              onFocus={() => setFormulaHelpOpen(true)}
              onBlur={() => setFormulaHelpOpen(false)}
              onChange={(e) => setFormulaInput(e.target.value)}
              className="font-mono text-xs"
            />
            <HelpCircle className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          </div>
          {formulaInput && (
            <Button variant="ghost" size="sm" onClick={() => setFormulaInput("")}>
              Clear
            </Button>
          )}
        </div>
        {formulaError && <p className="mt-1 text-xs text-negative">{formulaError}</p>}

        {formulaHelpOpen && (
          <div className="absolute z-20 mt-2 w-full max-w-xl space-y-3 rounded-md border border-border bg-surface p-3 shadow-md">
            <div>
              <p className="text-xs font-semibold text-foreground">Fields</p>
              <table className="mt-1.5 w-full text-xs">
                <tbody>
                  {FORMULA_FIELD_INFO.map((f) => (
                    <tr key={f.field}>
                      <td className="whitespace-nowrap py-0.5 pr-3 font-mono text-accent">{f.field}</td>
                      <td className="py-0.5 pr-3 text-muted-foreground">{f.description}</td>
                      <td className="whitespace-nowrap py-0.5 font-mono text-muted-foreground">{f.example}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <p className="text-xs font-semibold text-foreground">Operators &amp; syntax</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Comparisons: <code className="font-mono">&gt; &lt; &gt;= &lt;= == !=</code>. Combine with{" "}
                <code className="font-mono">AND</code>, <code className="font-mono">OR</code>,{" "}
                <code className="font-mono">NOT</code>, and parentheses. Number suffixes:{" "}
                <code className="font-mono">%</code> divides by 100 (e.g. <code className="font-mono">15%</code> ={" "}
                0.15), <code className="font-mono">B</code>/<code className="font-mono">M</code> multiply by
                billion/million. Field names aren't case-sensitive.
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold text-foreground">Examples (click to use)</p>
              <div className="mt-1.5 flex flex-col gap-1">
                {FORMULA_EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault(); // keep focus on the input instead of blurring the popup away
                      setFormulaInput(ex);
                    }}
                    className="rounded-md px-2 py-1 text-left font-mono text-xs text-foreground/80 hover:bg-surface-hover"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
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
