import type { SentimentSourceId } from "@proverbs/shared";
import { SENTIMENT_SOURCES } from "@proverbs/shared";
import { cn } from "../../lib/utils";

/** Checkbox list of every sentiment source considered — available ones are toggleable, unavailable ones are shown disabled with why (see SENTIMENT_SOURCES in shared/src/sentiment.ts) rather than hidden. */
export function SentimentSourcePicker({
  selected,
  onToggle,
}: {
  selected: SentimentSourceId[];
  onToggle: (id: SentimentSourceId) => void;
}) {
  return (
    <div className="relative">
      <details className="group">
        <summary className="flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-sm">
          Sources ({selected.length})
        </summary>
        <div className="absolute z-10 mt-2 w-72 space-y-1.5 rounded-md border border-border bg-surface p-3 shadow-sm">
          {SENTIMENT_SOURCES.map((s) => (
            <label
              key={s.id}
              className={cn("flex items-start gap-2 text-sm", !s.available && "cursor-not-allowed opacity-50")}
            >
              <input
                type="checkbox"
                className="mt-0.5"
                checked={s.available && selected.includes(s.id)}
                disabled={!s.available}
                onChange={() => s.available && onToggle(s.id)}
              />
              <span>
                {s.label}
                {!s.available && <span className="block text-xs text-muted-foreground">{s.unavailableReason}</span>}
              </span>
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}
