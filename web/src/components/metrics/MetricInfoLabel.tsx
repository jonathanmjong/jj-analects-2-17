import { useRef, useState } from "react";
import type { MetricDefinition } from "@proverbs/shared";
import { getMetricRationale } from "@proverbs/shared";
import { Badge, type BadgeProps } from "../ui/Badge";
import { cn } from "../../lib/utils";

const VERDICT_LABEL = {
  core: "Core value measure",
  supporting: "Supporting signal",
  caveat: "Use with caution",
  "not-value-investing": "Not value investing",
} as const;

const VERDICT_VARIANT: Record<keyof typeof VERDICT_LABEL, NonNullable<BadgeProps["variant"]>> = {
  core: "positive",
  supporting: "accent",
  caveat: "negative",
  "not-value-investing": "neutral",
};

/**
 * Wraps a metric's label (Rankings weight sliders, Company page metric tables — anywhere a raw
 * metric name is shown to a subscriber, not just the admin-only Value Metrics panel) with a
 * hover tooltip: which direction is better, what the metric actually measures, and the same
 * value-investing rationale content admins see (shared/src/metricRationale.ts) — one source of
 * truth for "is this a sound value-investing measure," not a second copy of the commentary.
 *
 * Fixed-position panel, same technique as Shell.tsx's ReferralButton and
 * TickerHoverLink — both callers render inside overflow-x-auto containers (a details/summary
 * weight panel and a wide metrics table), which would clip a plain CSS-absolute tooltip.
 */
export function MetricInfoLabel({ metric, className }: { metric: MetricDefinition; className?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function show() {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    const rect = anchorRef.current?.getBoundingClientRect();
    if (rect) {
      setPos({ top: rect.bottom + 6, left: Math.min(rect.left, window.innerWidth - 296) });
    }
    setOpen(true);
  }

  function hideSoon() {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setOpen(false), 120);
  }

  const info = getMetricRationale(metric.key, metric.category);

  return (
    <span
      ref={anchorRef}
      className={cn("cursor-help underline decoration-dotted decoration-muted-foreground/50", className)}
      onMouseEnter={show}
      onMouseLeave={hideSoon}
    >
      {metric.label}
      {open && pos && (
        <span
          className="fixed z-50 block w-72 rounded-lg border border-border bg-surface p-3 text-left text-xs font-normal normal-case shadow-lg"
          style={{ top: pos.top, left: pos.left }}
          onMouseEnter={show}
          onMouseLeave={hideSoon}
        >
          <span className="mb-1.5 flex items-center justify-between gap-2">
            <span className="font-semibold text-foreground">{metric.label}</span>
            <Badge variant={VERDICT_VARIANT[info.verdict]}>{VERDICT_LABEL[info.verdict]}</Badge>
          </span>
          <span className="mb-1.5 block text-muted-foreground">{metric.description}</span>
          <span className="mb-1.5 block font-medium text-foreground">
            {metric.direction === "desc" ? "Higher is better" : "Lower is better"}
            {metric.negativeIsBad && " — a negative value ranks below every positive one, regardless of size"}
          </span>
          <span className="block text-muted-foreground">{info.rationale}</span>
        </span>
      )}
    </span>
  );
}
