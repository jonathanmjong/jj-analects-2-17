import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-[4px] px-1.5 py-0.5 text-[12px] font-medium", {
  variants: {
    variant: {
      neutral: "bg-surface-muted text-foreground/80",
      accent: "bg-accent/10 text-accent",
      positive: "bg-positive/10 text-positive",
      negative: "bg-negative/10 text-negative",
    },
  },
  defaultVariants: { variant: "neutral" },
});

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
