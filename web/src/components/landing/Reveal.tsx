import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../../lib/utils";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Fades + slides an element in the first time it scrolls into view. Skips the animation entirely under prefers-reduced-motion. */
export function Reveal({ children, className, delayMs = 0 }: { children: ReactNode; className?: string; delayMs?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(prefersReducedMotion);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect(); // animate in once; don't re-trigger scrolling back up
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{ transitionDelay: inView ? `${delayMs}ms` : "0ms" }}
      className={cn(
        "transition-all duration-700 ease-out",
        inView ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
