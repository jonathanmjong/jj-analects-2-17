/**
 * "A" monogram, thin single-stroke geometric letterform whose crossbar
 * tilts upward into a small terminal dot — a rising trendline built into
 * the letter itself, rather than a literal bar-chart icon. Uses
 * currentColor so it always matches the surrounding text (sidebar ink,
 * landing-page header, dark mode) without extra props.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <path
        d="M16 5 L6.5 27 M16 5 L25.5 27 M10.5 19 L21 15.5"
        stroke="currentColor"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="21" cy="15.5" r="1.5" fill="currentColor" />
    </svg>
  );
}
