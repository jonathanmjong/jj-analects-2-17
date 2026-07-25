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
import { Download, SlidersHorizontal } from "lucide-react";
import type { Company, MetricCategory, Sector } from "@proverbs/shared";
import { DEFAULT_RANKING_CONFIG, METRIC_CATEGORIES, SECTORS } from "@proverbs/shared";
import { useCompaniesList } from "../hooks/useCompanies";
import { useAllRankings } from "../hooks/useAllRankings";
import { useCustomRankings } from "../hooks/useCustomRankings";
import { useMetricDefinitions } from "../hooks/useMetricDefinitions";
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
    setMetricWeight,
    resetMetricWeights,
    setCategoryWeight,
    setYearsIncluded,
    setConfig,
    recompute,
    config: customConfig,
  } = useCustomRankings();
  const yearsIncluded = customConfig.yearsIncluded;
  const [metricWeightInputs, setMetricWeightInputs] = useState<Record<string, number>>({});
  const recomputeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [globalFilter, setGlobalFilter] = useState("");
  const [sectorFilter, setSectorFilter] = useState<Sector | "all">("all");
  const [countryFilter, setCountryFilter] = useState<string>("all");
  const [minCategoryWeightMetrics, setMinCategoryWeightMetrics] = useState(0);
  const [valueFilters, setValueFilters] = useState<ValueFilters>(EMPTY_VALUE_FILTERS);
  const [formulaInput, setFormulaInput] = useState("");
  const [sorting, setSorting] = useState<SortingState>([{ id: "latest.overallRank", desc: false }]);
  const [visibility, setVisibility] = useState<VisibilityState>({ industry: false, "latest.sharePrice": false, country: false });

  /** Categories the user currently has a nonzero weight on, per the Category weights panel. */
  const activeCategories = useMemo(
    () => METRIC_CATEGORIES.filter((c) => (customConfig.categoryWeights[c] ?? 0) > 0),
    [customConfig.categoryWeights],
  );

  const activeCategoryMetricCount = useMemo(
    () => (metricDefinitions ?? []).filter((m) => activeCategories.includes(m.category)).length,
    [metricDefinitions, activeCategories],
  );

  function categoryWeightDataAvailable(ticker: string): number {
    const scores = rankings?.get(ticker)?.categoryScores ?? [];
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
    recomputeTimer.current = setTimeout(() => void recompute(nextConfig), 350);
  }

  function handleYearsChange(value: number) {
    const nextConfig = setYearsIncluded(value as 1 | 2 | 3 | 4 | 5);
    if (recomputeTimer.current) clearTimeout(recomputeTimer.current);
    recomputeTimer.current = setTimeout(() => void recompute(nextConfig), 350);
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
    recomputeTimer.current = setTimeout(() => void recompute(nextConfig), 350);
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

  const customOverrideByTicker = useMemo(() => {
    if (!customResults) return null;
    return new Map(customResults.map((r) => [r.ticker, r]));
  }, [customResults]);

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
      if (sectorFilter !== "all" && c.sector !== sectorFilter) return false;
      if (countryFilter !== "all" && c.country !== countryFilter) return false;
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
          overallscore: c.latest?.overallScore ?? null,
        };
        if (!evaluateFormula(formulaNode, context)) return false;
      }

      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies, sectorFilter, countryFilter, minCategoryWeightMetrics, activeCategories, rankings, valueFilters, formulaNode]);

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

  const scatterData = useMemo<ScatterDatum[]>(() => {
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
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Rankings</h1>
        <p className="text-muted-foreground">Sort, filter, and export the full ranked universe.</p>
      </div>

      {scatterData.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Quality vs. Growth (ROIC × Revenue Growth, sized by market cap)</CardTitle>
          </CardHeader>
          <CardContent>
            <QualityGrowthScatter data={scatterData} onSelect={(ticker) => navigate(`/company/${ticker}`)} />
            <p className="mt-2 text-xs text-muted-foreground">
              Largest {scatterData.length} companies (by market cap) matching the current filters with both metrics
              available. Colored by sector.
            </p>
          </CardContent>
        </Card>
      )}

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

        <select
          value={countryFilter}
          onChange={(e) => setCountryFilter(e.target.value)}
          className="h-8 rounded-md border border-border bg-surface px-2.5 text-sm"
        >
          <option value="all">All countries</option>
          {countries.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <div className="flex min-w-48 items-center gap-2 text-sm">
          <span className="whitespace-nowrap text-muted-foreground">
            Years of data: {yearsIncluded} {recomputing && "· recomputing…"}
          </span>
          <Slider min={1} max={5} step={1} value={yearsIncluded} onChange={(e) => handleYearsChange(Number(e.target.value))} />
        </div>

        <div className="flex min-w-48 items-center gap-2 text-sm">
          <span className="whitespace-nowrap text-muted-foreground">
            Min. category weight data: {minCategoryWeightMetrics}/{activeCategoryMetricCount}
          </span>
          <Slider
            min={0}
            max={activeCategoryMetricCount}
            step={1}
            value={minCategoryWeightMetrics}
            onChange={(e) => setMinCategoryWeightMetrics(Number(e.target.value))}
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

      <div>
        <div className="flex items-center gap-2">
          <Input
            placeholder='Custom formula, e.g. "roic > 15% AND peTtm < 20 AND marketCap > 5B"'
            value={formulaInput}
            onChange={(e) => setFormulaInput(e.target.value)}
            className="max-w-xl font-mono text-xs"
          />
          {formulaInput && (
            <Button variant="ghost" size="sm" onClick={() => setFormulaInput("")}>
              Clear
            </Button>
          )}
        </div>
        {formulaError ? (
          <p className="mt-1 text-xs text-negative">{formulaError}</p>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            Fields: marketCap (use B/M suffix), roic, peTtm, evEbitda, dividendYield, fcfYield, revenueGrowth1y,
            overallScore. Operators: &gt; &lt; &gt;= &lt;= == != AND OR NOT ( ).
          </p>
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
