import { cn } from "../../lib/utils";

function scoreColor(score: number | null): string {
  if (score === null) return "bg-surface-muted text-muted-foreground";
  if (score >= 70) return "bg-positive/10 text-positive";
  if (score >= 40) return "bg-accent/10 text-accent";
  return "bg-negative/10 text-negative";
}

export function ScorePill({ score, className }: { score: number | null; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-12 justify-center rounded-full px-2.5 py-1 text-xs font-semibold", scoreColor(score), className)}>
      {score === null ? "—" : score.toFixed(1)}
    </span>
  );
}
