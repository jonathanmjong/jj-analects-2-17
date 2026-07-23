import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { BarChart3, GitCompare, Home as HomeIcon, LogOut, Menu, PieChart, User as UserIcon, X } from "lucide-react";
import { useAuth } from "../../context/AuthProvider";
import { cn } from "../../lib/utils";

const NAV_LINKS = [
  { to: "/", label: "Home", icon: HomeIcon },
  { to: "/rankings", label: "Rankings", icon: BarChart3 },
  { to: "/sectors", label: "Sectors", icon: PieChart },
  { to: "/compare", label: "Compare", icon: GitCompare },
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, subscribed, signOut } = useAuth();

  return (
    <div className="flex h-full flex-col px-3 py-4">
      <Link to="/" className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-hover" onClick={onNavigate}>
        <span className="text-base leading-none">📈</span>
        <span className="text-sm font-semibold">Analects 2.17</span>
      </Link>

      <nav className="mt-4 flex flex-col gap-0.5">
        {NAV_LINKS.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.to === "/"}
            onClick={onNavigate}
            className={({ isActive }: { isActive: boolean }) =>
              cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground/80 transition-colors hover:bg-surface-hover",
                isActive && "bg-surface-hover font-medium text-foreground",
              )
            }
          >
            <link.icon className="h-4 w-4 text-muted-foreground" />
            {link.label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-2 border-t border-border pt-3">
        {user ? (
          <>
            {!subscribed && (
              <Link
                to="/billing"
                onClick={onNavigate}
                className="rounded-md bg-accent px-2 py-1.5 text-center text-sm font-medium text-accent-foreground hover:opacity-90"
              >
                Start free trial
              </Link>
            )}
            <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
              {user.photoURL ? (
                <img src={user.photoURL} alt="" className="h-6 w-6 rounded-full" referrerPolicy="no-referrer" />
              ) : (
                <UserIcon className="h-6 w-6 rounded-full bg-surface-muted p-1" />
              )}
              <span className="truncate text-xs text-muted-foreground">{user.email}</span>
              <button
                onClick={() => signOut()}
                className="ml-auto text-muted-foreground hover:text-foreground"
                aria-label="Sign out"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          </>
        ) : (
          <Link
            to="/login"
            onClick={onNavigate}
            className="rounded-md bg-accent px-2 py-1.5 text-center text-sm font-medium text-accent-foreground hover:opacity-90"
          >
            Sign in
          </Link>
        )}
      </div>
    </div>
  );
}

export function Shell() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const location = useLocation();

  // Close the mobile nav automatically whenever the route changes.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-sidebar md:flex">
        <SidebarContent />
      </aside>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="w-64 shrink-0 border-r border-border bg-sidebar">
            <SidebarContent onNavigate={() => setMobileNavOpen(false)} />
          </div>
          <button
            className="flex-1 bg-black/30"
            aria-label="Close menu"
            onClick={() => setMobileNavOpen(false)}
          />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-background px-4 py-3 md:hidden">
          <button
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open menu"
            className="rounded-md p-1.5 hover:bg-surface-hover"
          >
            {mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <Link to="/" className="flex items-center gap-2">
            <span className="text-base leading-none">📈</span>
            <span className="text-sm font-semibold">Analects 2.17</span>
          </Link>
        </div>

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8 md:px-10 md:py-10">
          <Outlet />
        </main>
        <footer className="border-t border-border px-4 py-6 text-center text-xs text-muted-foreground sm:px-6 md:px-10">
          Analects 2.17 — "When you know a thing, to hold that you know it; and when you do not know a thing, to
          allow that you do not know it — this is knowledge." Data from Yahoo Finance and SEC EDGAR; not investment
          advice.
        </footer>
      </div>
    </div>
  );
}
