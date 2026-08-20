import { useRef, type KeyboardEvent } from "react";
import { cn } from "../../lib/utils";

export interface SegmentedTabOption<T extends string> {
  value: T;
  label: string;
}

/** Stable id for a tab button, so a panel can point back at it with aria-labelledby. */
export function segmentedTabId(idBase: string, value: string): string {
  return `${idBase}-tab-${value}`;
}

/**
 * The one segmented tab bar in the app: the Company page's top-level sections and
 * the statement explorer's Income/Balance/Cash Flow switch render from this, so the
 * page never sprouts two tab styles.
 *
 * Follows the ARIA tabs pattern including its roving tabindex — only the selected
 * tab is in the tab order and arrow keys move between them, which is why the whole
 * bar (not each button) owns the keydown handler.
 */
export function SegmentedTabs<T extends string>({
  idBase,
  label,
  options,
  value,
  onChange,
  panelId,
  size = "sm",
  className,
}: {
  idBase: string;
  /** Names the tablist for assistive tech, e.g. "Company sections". */
  label: string;
  options: ReadonlyArray<SegmentedTabOption<T>>;
  value: T;
  onChange: (next: T) => void;
  /** id of the panel currently rendered for `value`, if the caller renders one. */
  panelId?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const buttons = useRef(new Map<T, HTMLButtonElement>());

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = options.findIndex((option) => option.value === value);
    if (current < 0) return;
    let next = current;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (current + 1) % options.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (current - 1 + options.length) % options.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = options.length - 1;
    else return;
    event.preventDefault();
    const option = options[next];
    if (!option) return;
    onChange(option.value);
    buttons.current.get(option.value)?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={handleKeyDown}
      className={cn("flex flex-wrap gap-1 rounded-md border border-border bg-surface p-0.5", className)}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(element) => {
              if (element) buttons.current.set(option.value, element);
              else buttons.current.delete(option.value);
            }}
            id={segmentedTabId(idBase, option.value)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={selected ? panelId : undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
              size === "md" ? "px-3 py-1.5 text-[13px]" : "px-2.5 py-1 text-xs",
              selected ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-surface-hover",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
