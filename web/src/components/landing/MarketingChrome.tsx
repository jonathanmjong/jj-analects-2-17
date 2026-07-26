import { Link } from "react-router-dom";
import { Button } from "../ui/Button";
import { Logo } from "../ui/Logo";

/** Simple header for standalone marketing pages (comparison, preview) that don't have in-page scroll-spy sections like the landing page does. */
export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2">
          <Logo className="h-4 w-4 shrink-0" />
          <span className="text-sm font-semibold">Analects 2.17</span>
        </Link>
        <nav className="flex items-center gap-3">
          <Link to="/login" className="text-sm text-muted-foreground hover:text-foreground">
            Sign in
          </Link>
          <Link to="/login">
            <Button size="sm" className="rounded-full px-4">
              Get started
            </Button>
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-border px-4 py-8 text-center text-xs text-muted-foreground sm:px-6">
      Analects 2.17 — "When you know a thing, to hold that you know it; and when you do not know a thing, to
      allow that you do not know it — this is knowledge." Data from Yahoo Finance and SEC EDGAR; not investment
      advice.
    </footer>
  );
}
