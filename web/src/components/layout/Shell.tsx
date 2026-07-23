import { Link, NavLink, Outlet } from "react-router-dom";
import { BarChart3, GitCompare, Home as HomeIcon, LogOut, PieChart, User as UserIcon } from "lucide-react";
import { useAuth } from "../../context/AuthProvider";
import { cn } from "../../lib/utils";

const NAV_LINKS = [
  { to: "/", label: "Home", icon: HomeIcon },
  { to: "/rankings", label: "Rankings", icon: BarChart3 },
  { to: "/sectors", label: "Sectors", icon: PieChart },
  { to: "/compare", label: "Compare", icon: GitCompare },
];

export function Shell() {
  const { user, subscribed, signOut } = useAuth();

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-sidebar md:flex">
        <div className="flex h-full flex-col px-3 py-4">
          <Link to="/" className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-hover">
            <span className="text-base leading-none">📈</span>
            <span className="text-sm font-semibold">Proverbs 21:5</span>
          </Link>

          <nav className="mt-4 flex flex-col gap-0.5">
            {NAV_LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === "/"}
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
                className="rounded-md bg-accent px-2 py-1.5 text-center text-sm font-medium text-accent-foreground hover:opacity-90"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8 md:px-10 md:py-10">
          <Outlet />
        </main>
        <footer className="border-t border-border px-6 py-6 text-center text-xs text-muted-foreground md:px-10">
          Proverbs 21:5 — "The plans of the diligent lead surely to abundance." Data from Yahoo Finance and SEC
          EDGAR; not investment advice.
        </footer>
      </div>
    </div>
  );
}
