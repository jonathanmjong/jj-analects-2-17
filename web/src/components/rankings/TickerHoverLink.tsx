import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Company } from "@proverbs/shared";
import { ScorePill } from "../ui/ScorePill";
import { formatCurrency, formatMultiple, formatPercent } from "../../lib/utils";
import { cn } from "../../lib/utils";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

/**
 * Ticker cell for the Rankings table: hovering shows a quick-peek company summary without
 * leaving the list; clicking opens the full Company page in a new tab (deliberately different
 * from clicking elsewhere in the row, which still navigates the current tab — see the <tr>
 * onClick in RankingsPage.tsx) so a user can skim several companies' details without losing
 * their place in the ranked list.
 *
 * Positioned via a fixed-coordinate panel (not plain CSS absolute) for the same reason as
 * Shell.tsx's ReferralButton popover: the table's wrapper is overflow-x-auto, which would clip
 * a popover anchored with position: absolute before it ever became visible.
 */
export function TickerHoverLink({ company }: { company: Company }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function show() {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    const rect = linkRef.current?.getBoundingClientRect();
    if (rect) {
      setPos({ top: rect.bottom + 6, left: Math.min(rect.left, window.innerWidth - 288) });
    }
    setOpen(true);
  }

  function hideSoon() {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setOpen(false), 120);
  }

  const latest = company.latest;
  const headline = latest?.headlineMetrics;

  return (
    <span className="relative inline-block" onMouseEnter={show} onMouseLeave={hideSoon}>
      <Link
        ref={linkRef}
        to={`/company/${company.ticker}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="font-medium hover:text-accent"
      >
        {company.ticker}
      </Link>
      {open && pos && (
        <div
          className="fixed z-50 w-72 rounded-lg border border-border bg-surface p-3 text-xs shadow-lg"
          style={{ top: pos.top, left: pos.left }}
          onMouseEnter={show}
          onMouseLeave={hideSoon}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-2 flex items-start justify-between gap-2">
            <div>
              <div className="font-semibold">{company.companyName}</div>
              <div className="text-muted-foreground">
                {company.sector ?? "—"}
                {company.industry ? ` · ${company.industry}` : ""}
              </div>
            </div>
            <ScorePill score={latest?.overallScore ?? null} />
          </div>
          <div className="space-y-1">
            <Stat label="Rank" value={latest?.overallRank ? `#${latest.overallRank}` : "—"} />
            <Stat
              label="Price"
              value={
                latest?.sharePrice != null
                  ? `${latest.priceSource === "sec_public_float" ? "~" : ""}${formatCurrency(latest.sharePrice)}`
                  : "—"
              }
            />
            <Stat label="Market Cap" value={formatCurrency(latest?.marketCap ?? null, { compact: true })} />
            <Stat label="P/E (TTM)" value={formatMultiple(headline?.peTtm ?? null)} />
            <Stat label="ROIC" value={formatPercent(headline?.roic ?? null)} />
            <Stat label="Revenue Growth (1Y)" value={formatPercent(headline?.revenueGrowth1y ?? null)} />
          </div>
          <div className={cn("mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground")}>
            Click the ticker above to open full details in a new tab
          </div>
        </div>
      )}
    </span>
  );
}
