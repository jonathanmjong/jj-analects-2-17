/**
 * Three ascending bars, evenly weighted and unadorned — a mark meant to
 * read as "ranked, compounding, understated" rather than a literal chart
 * icon. Uses currentColor so it always matches the surrounding text
 * (sidebar ink, landing-page header, dark mode) without extra props.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <rect x="5.5" y="17.5" width="5" height="9" rx="2.5" fill="currentColor" />
      <rect x="13.5" y="11.5" width="5" height="15" rx="2.5" fill="currentColor" />
      <rect x="21.5" y="5.5" width="5" height="21" rx="2.5" fill="currentColor" />
    </svg>
  );
}
