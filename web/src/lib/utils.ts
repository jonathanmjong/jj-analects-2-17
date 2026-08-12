import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number | null, opts: { compact?: boolean } = {}): string {
  if (value === null || Number.isNaN(value)) return "—";
  if (opts.compact) {
    // ICU versions disagree on whether compact notation keeps a trailing ".0"
    // (surfaced as a CI-vs-local test mismatch) — strip it so output is
    // deterministic across Node and browser versions.
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 1,
    })
      .format(value)
      .replace(/\.0([KMBT])$/, "$1");
  }
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export function formatPercent(value: number | null, digits = 1): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatMultiple(value: number | null, digits = 1): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${value.toFixed(digits)}x`;
}

export function formatNumber(value: number | null, digits = 1): string {
  if (value === null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value);
}
