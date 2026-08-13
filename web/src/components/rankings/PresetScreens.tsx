import { useMemo, useRef, useState } from "react";
import { ChevronDown, ListFilter } from "lucide-react";
import { STRATEGIES, type StrategyDefinition } from "@proverbs/shared";
import { evaluateFormula, FormulaError, parseFormula, type FormulaContext } from "../../lib/formulaFilter";
import { Badge } from "../ui/Badge";

interface PresetScreensProps {
  /** One context per loaded company — the same records the formula filter evaluates. */
  contexts: FormulaContext[];
  /** Field names addressable in formulas (registry metric keys present in the loaded universe). */
  fields: string[];
  /** Current contents of the formula input, so an already-applied screen can be marked. */
  activeFormula: string;
  /** Writes the screen's formula into the visible formula input — never applied invisibly. */
  onApply: (formula: string) => void;
}

interface ScreenState {
  definition: StrategyDefinition;
  /** null when the formula can't be evaluated against the currently loaded fields. */
  matches: number | null;
  error: string | null;
}

export function PresetScreens({ contexts, fields, activeFormula, onApply }: PresetScreensProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const screens = useMemo<ScreenState[]>(() => {
    return STRATEGIES.map((definition) => {
      try {
        const node = parseFormula(definition.screenFormula, fields);
        return { definition, matches: contexts.filter((c) => evaluateFormula(node, c)).length, error: null };
      } catch (e) {
        return {
          definition,
          matches: null,
          error: e instanceof FormulaError ? e.message : "This screen can't be evaluated against the loaded data.",
        };
      }
    });
  }, [contexts, fields]);

  const normalizedActive = activeFormula.trim();

  function apply(formula: string) {
    onApply(formula);
    if (detailsRef.current) detailsRef.current.open = false;
  }

  return (
    <details ref={detailsRef} className="group relative">
      <summary className="flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-sm">
        <ListFilter className="h-3.5 w-3.5" />
        Preset screens
      </summary>
      <div className="absolute z-20 mt-2 max-h-[28rem] w-[26rem] overflow-y-auto rounded-md border border-border bg-surface p-3 shadow-md">
        <p className="text-xs text-muted-foreground">
          Rule chains from the published value literature. Picking one writes its formula into the box below, where
          you can see and edit every threshold. Match counts are over all {contexts.length.toLocaleString()} loaded
          companies, before your other filters.
        </p>
        <div className="mt-2 divide-y divide-border">
          {screens.map(({ definition, matches, error }) => {
            const isActive = normalizedActive === definition.screenFormula;
            const isOpen = expanded === definition.key;
            return (
              <div key={definition.key} className="py-2">
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => apply(definition.screenFormula)}
                    className="flex-1 rounded-md px-1 py-0.5 text-left text-sm text-foreground hover:bg-surface-hover"
                  >
                    {definition.name}
                  </button>
                  <span className="flex shrink-0 items-center gap-1.5 pt-0.5">
                    {isActive && <Badge variant="accent">in formula</Badge>}
                    {matches === null ? (
                      <span className="text-xs text-muted-foreground" title={error ?? undefined}>
                        unavailable
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">{matches.toLocaleString()} match</span>
                    )}
                    <button
                      type="button"
                      aria-label={`Source and thresholds for ${definition.name}`}
                      onClick={() => setExpanded(isOpen ? null : definition.key)}
                      className="rounded p-0.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                    >
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    </button>
                  </span>
                </div>
                <p className="px-1 text-[11px] text-muted-foreground">{definition.description}</p>
                {matches === 0 && (
                  <p className="px-1 text-[11px] text-muted-foreground">
                    Nothing in the loaded universe passes this chain right now — the thresholds are absolute, not
                    relative to today's market.
                  </p>
                )}
                {isOpen && (
                  <div className="mt-1.5 space-y-1 rounded-md bg-surface-muted p-2 text-[11px] text-muted-foreground">
                    <p>
                      <span className="text-foreground/80">{definition.source.name}</span> · published{" "}
                      {definition.source.published}
                    </p>
                    <p>Tested on: {definition.source.testedUniverse}</p>
                    {definition.source.caveat && <p>{definition.source.caveat}</p>}
                    <p className="break-words font-mono text-[10px] text-foreground/70">{definition.screenFormula}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </details>
  );
}
