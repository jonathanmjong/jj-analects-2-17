import { useMemo, useState } from "react";
import type { CashFlowStatement, IncomeStatement, ScenarioDriver, ScenarioInput } from "@proverbs/shared";
import {
  computeScenario,
  DEFAULT_SCENARIO_YEARS,
  dominantDriver,
  effectiveTaxRate,
  EXIT_PE_SWING,
  scenarioDefaults,
} from "@proverbs/shared";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/Card";
import { Slider } from "../ui/Slider";

const GROWTH_RANGE = { min: -0.1, max: 0.3, step: 0.005 };
const MARGIN_RANGE = { min: 0, max: 0.5, step: 0.005 };
const EXIT_PE_RANGE = { min: 5, max: 40, step: 0.5 };

const DRIVER_LABEL: Record<ScenarioDriver, string> = {
  growth: "revenue growth",
  margin: "operating margin",
  exitPe: "the exit multiple",
};

interface SliderValues {
  growth: number;
  margin: number;
  exitPe: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** ≤2 significant figures everywhere: a scenario is arithmetic on guesses, and a third digit would dress it as precision. */
function twoSigFigs(value: number): number {
  if (value === 0 || !Number.isFinite(value)) return value;
  const factor = 10 ** (Math.floor(Math.log10(Math.abs(value))) - 1);
  return Math.round(value / factor) * factor;
}

function percentText(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const pct = value * 100;
  return `${+pct.toFixed(Math.abs(pct) >= 10 ? 0 : 1)}%`;
}

function priceText(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const rounded = twoSigFigs(value);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(rounded) < 10 ? 1 : 0,
  }).format(rounded);
}

function multipleText(value: number): string {
  return `${+value.toFixed(Math.abs(value) >= 10 ? 0 : 1)}×`;
}

function SliderRow({
  label,
  prefillNote,
  dispersionNote,
  valueText,
  range,
  value,
  bandLow,
  bandHigh,
  onChange,
}: {
  label: string;
  prefillNote: string;
  dispersionNote: string;
  valueText: string;
  range: { min: number; max: number; step: number };
  value: number;
  bandLow: number;
  bandHigh: number;
  onChange: (value: number) => void;
}) {
  const position = (v: number) => clamp(((v - range.min) / (range.max - range.min)) * 100, 0, 100);
  const left = position(Math.min(bandLow, bandHigh));
  const width = Math.max(position(Math.max(bandLow, bandHigh)) - left, 0.5);

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm">{label}</span>
        <span className="text-sm font-medium">{valueText}</span>
      </div>
      <div className="relative h-1.5">
        <div className="absolute inset-0 rounded-full bg-surface-muted" />
        <div className="absolute inset-y-0 rounded-full bg-accent/25" style={{ left: `${left}%`, width: `${width}%` }} />
        <Slider
          min={range.min}
          max={range.max}
          step={range.step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 bg-transparent"
          aria-label={label}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {prefillNote} · {dispersionNote}
      </p>
    </div>
  );
}

export function ScenarioTool({
  income,
  cashFlow,
  sharePrice,
  sharesOutstanding,
}: {
  income: IncomeStatement[];
  cashFlow: CashFlowStatement[];
  sharePrice: number | null;
  sharesOutstanding: number | null;
}) {
  const [custom, setCustom] = useState<SliderValues | null>(null);

  const latest = useMemo(() => {
    const sorted = [...income].sort((a, b) => b.fiscalYear - a.fiscalYear);
    return sorted.find((statement) => statement.revenue !== null && statement.revenue > 0) ?? null;
  }, [income]);

  const defaults = useMemo(
    () => scenarioDefaults(income, cashFlow, { sharePrice, sharesOutstanding }),
    [income, cashFlow, sharePrice, sharesOutstanding],
  );

  const prefill = useMemo<SliderValues>(
    () => ({
      growth: clamp(defaults.growth.median, GROWTH_RANGE.min, GROWTH_RANGE.max),
      margin: clamp(defaults.margin.median, MARGIN_RANGE.min, MARGIN_RANGE.max),
      exitPe: clamp(defaults.exitPe.suggested, EXIT_PE_RANGE.min, EXIT_PE_RANGE.max),
    }),
    [defaults],
  );
  const values = custom ?? prefill;

  const taxRate = latest === null ? undefined : effectiveTaxRate(latest);

  const base = useMemo<ScenarioInput | null>(
    () =>
      latest?.revenue == null || sharePrice === null || sharesOutstanding === null
        ? null
        : {
            revenueBase: latest.revenue,
            sharesOutstanding,
            sharePrice,
            growthRate: values.growth,
            operatingMargin: values.margin,
            exitPe: values.exitPe,
            years: DEFAULT_SCENARIO_YEARS,
            taxRate,
          },
    [latest, sharePrice, sharesOutstanding, values, taxRate],
  );

  const growthHalfWidth = (defaults.growth.high - defaults.growth.low) / 2;
  const marginHalfWidth = (defaults.margin.high - defaults.margin.low) / 2;

  const cases = useMemo(() => {
    if (base === null) return [];
    const variants: Array<{ name: string; inputs: SliderValues }> = [
      {
        name: "Bull",
        inputs: {
          growth: clamp(values.growth + growthHalfWidth, GROWTH_RANGE.min, GROWTH_RANGE.max),
          margin: clamp(values.margin + marginHalfWidth, MARGIN_RANGE.min, MARGIN_RANGE.max),
          exitPe: clamp(values.exitPe * (1 + EXIT_PE_SWING), EXIT_PE_RANGE.min, EXIT_PE_RANGE.max),
        },
      },
      { name: "Base", inputs: values },
      {
        name: "Bear",
        inputs: {
          growth: clamp(values.growth - growthHalfWidth, GROWTH_RANGE.min, GROWTH_RANGE.max),
          margin: clamp(values.margin - marginHalfWidth, MARGIN_RANGE.min, MARGIN_RANGE.max),
          exitPe: clamp(values.exitPe * (1 - EXIT_PE_SWING), EXIT_PE_RANGE.min, EXIT_PE_RANGE.max),
        },
      },
    ];

    return variants.map((variant) => ({
      ...variant,
      result: computeScenario({
        ...base,
        growthRate: variant.inputs.growth,
        operatingMargin: variant.inputs.margin,
        exitPe: variant.inputs.exitPe,
      }),
    }));
  }, [base, values, growthHalfWidth, marginHalfWidth]);

  const sensitivity = useMemo(
    () =>
      base === null
        ? null
        : dominantDriver({
            base,
            growth: { low: defaults.growth.low, high: defaults.growth.high },
            margin: { low: defaults.margin.low, high: defaults.margin.high },
          }),
    [base, defaults],
  );

  const prefillNote = (band: { observations: number; basis: "history" | "convention" }, unit: string) =>
    band.basis === "history"
      ? `pre-filled at the ${band.observations}-year median ${unit} — the past, not a forecast`
      : `pre-filled at a conventional ${unit} — this company has no usable history for it, and it is not a forecast`;

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>What Would It Take? — Scenario</CardTitle>
        {custom !== null && (
          <button
            type="button"
            onClick={() => setCustom(null)}
            className="h-7 rounded-md border border-border bg-surface px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            Reset to this company's history
          </button>
        )}
      </CardHeader>

      <CardContent className="space-y-4 pt-2">
        {base === null ? (
          <p className="text-sm text-muted-foreground">
            This scenario cannot be run: it needs an annual revenue figure, a share price and a diluted share count, and
            at least one of the three is missing for this company.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <div className="space-y-4">
                <SliderRow
                  label="Revenue growth"
                  prefillNote={prefillNote(defaults.growth, "growth rate")}
                  dispersionNote={`its own range was ${percentText(defaults.growth.low)} to ${percentText(defaults.growth.high)}/yr`}
                  valueText={`${percentText(values.growth)}/yr`}
                  range={GROWTH_RANGE}
                  value={values.growth}
                  bandLow={defaults.growth.low}
                  bandHigh={defaults.growth.high}
                  onChange={(growth) => setCustom({ ...values, growth })}
                />
                <SliderRow
                  label="Operating margin"
                  prefillNote={prefillNote(defaults.margin, "margin")}
                  dispersionNote={`its own range was ${percentText(defaults.margin.low)} to ${percentText(defaults.margin.high)}`}
                  valueText={percentText(values.margin)}
                  range={MARGIN_RANGE}
                  value={values.margin}
                  bandLow={defaults.margin.low}
                  bandHigh={defaults.margin.high}
                  onChange={(margin) => setCustom({ ...values, margin })}
                />
                <SliderRow
                  label={`Exit P/E in ${DEFAULT_SCENARIO_YEARS} years`}
                  prefillNote={defaults.exitPe.note}
                  dispersionNote={`the shaded band is the ±${Math.round(EXIT_PE_SWING * 100)}% swing used for the bull and bear cases, not history`}
                  valueText={multipleText(values.exitPe)}
                  range={EXIT_PE_RANGE}
                  value={values.exitPe}
                  bandLow={values.exitPe * (1 - EXIT_PE_SWING)}
                  bandHigh={values.exitPe * (1 + EXIT_PE_SWING)}
                  onChange={(exitPe) => setCustom({ ...values, exitPe })}
                />
              </div>

              <div className="space-y-3">
                {cases.map(({ name, inputs, result }) => (
                  <div key={name} className="border-l-2 border-border pl-3">
                    <div className="text-xs uppercase text-muted-foreground">{name}</div>
                    {result.status === "unavailable" ? (
                      <p className="text-sm text-muted-foreground">Not computable — {result.reason}.</p>
                    ) : (
                      <p className="text-sm">
                        If revenue grows {percentText(inputs.growth)}/yr at {percentText(inputs.margin)} margins and the
                        market pays {multipleText(inputs.exitPe)} in {DEFAULT_SCENARIO_YEARS} years →{" "}
                        <span className="font-medium">~{priceText(result.impliedPrice)}</span> (≈
                        {percentText(result.annualizedReturn)}/yr)
                      </p>
                    )}
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  Bull and bear move growth and margin by half this company's own historical high-to-low range either
                  side of your settings, and the exit multiple by ±{Math.round(EXIT_PE_SWING * 100)}%. They are not
                  probabilities.
                </p>
              </div>
            </div>

            {sensitivity?.driver != null && (
              <p className="border-t border-border pt-3 text-sm">
                Most sensitive to: <span className="font-medium">{DRIVER_LABEL[sensitivity.driver]}</span>
                <span className="text-muted-foreground">
                  {" "}
                  — moving it alone across its range swings the annual return by about{" "}
                  {percentText(sensitivity.spreads[sensitivity.driver])}, against{" "}
                  {(Object.keys(DRIVER_LABEL) as ScenarioDriver[])
                    .filter((driver) => driver !== sensitivity.driver)
                    .map((driver) => `${percentText(sensitivity.spreads[driver])} for ${DRIVER_LABEL[driver]}`)
                    .join(" and ")}
                  .
                </span>
              </p>
            )}

            <div className="space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
              <p>
                Revenue compounds from FY{latest?.fiscalYear} for {DEFAULT_SCENARIO_YEARS} years, the final year earns
                the margin you set, and tax is applied at{" "}
                {taxRate === undefined ? "the conventional rate" : `${percentText(taxRate)} — this company's own latest effective rate`}
                . Earnings per share use today's diluted share count, so no buybacks, dilution or share-based
                compensation are modelled; interest expense is not deducted; the return is price-only and adds back no
                dividends.
              </p>
              <p>Arithmetic on your assumptions — not a forecast or recommendation.</p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
