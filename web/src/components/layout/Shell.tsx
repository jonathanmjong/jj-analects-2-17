import { Link, NavLink, Outlet } from "react-router-dom";
import { LogOut, User as UserIcon } from "lucide-react";
import { useAuth } from "../../context/AuthProvider";
import { cn } from "../../lib/utils";

const NAV_LINKS = [
  { to: "/", label: "Home" },
  { to: "/rankings", label: "Rankings" },
  { to: "/sectors", label: "Sectors" },
  { to: "/compare", label: "Compare" },
];

export function Shell() {
  const { user, subscribed, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <Link to="/" className="flex items-baseline gap-2">
            <span className="text-lg font-semibold tracking-tight">Proverbs 21:5</span>
            <span className="hidden text-xs text-muted-foreground sm:inline">multi-factor equity rankings</span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {NAV_LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === "/"}
                className={({ isActive }: { isActive: boolean }) =>
                  cn(
                    "rounded-full px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
                    isActive && "bg-surface-muted text-foreground",
                  )
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            {user ? (
              <>
                {!subscribed && (
                  <Link
                    to="/billing"
                    className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-foreground"
                  >
                    Start free trial
                  </Link>
                )}
                <div className="flex items-center gap-2">
                  {user.photoURL ? (
                    <img src={user.photoURL} alt="" className="h-8 w-8 rounded-full" referrerPolicy="no-referrer" />
                  ) : (
                    <UserIcon className="h-8 w-8 rounded-full bg-surface-muted p-1.5" />
                  )}
                  <button
                    onClick={() => signOut()}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Sign out"
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                </div>
              </>
            ) : (
              <Link to="/login" className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-foreground">
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-10">
        <Outlet />
      </main>

      <footer className="border-t border-border/70 py-8 text-center text-xs text-muted-foreground">
        Proverbs 21:5 — "The plans of the diligent lead surely to abundance." Data from Yahoo Finance and SEC EDGAR;
        not investment advice.
      </footer>
    </div>
  );
}
