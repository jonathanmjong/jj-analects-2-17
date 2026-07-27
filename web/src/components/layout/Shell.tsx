import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  BarChart3,
  Check,
  ChevronsLeft,
  ChevronsRight,
  Gift,
  GitCompare,
  LogOut,
  Menu,
  PieChart,
  Star,
  User as UserIcon,
  X,
} from "lucide-react";
import { useAuth } from "../../context/AuthProvider";
import { Logo } from "../ui/Logo";
import { referralLinkFor } from "../../lib/referral";
import { cn } from "../../lib/utils";

const NAV_LINKS = [
  { to: "/rankings", label: "Rankings", icon: BarChart3 },
  { to: "/sectors", label: "Sectors", icon: PieChart },
  { to: "/compare", label: "Compare", icon: GitCompare },
  { to: "/watchlist", label: "Watchlist", icon: Star },
];

const SIDEBAR_COLLAPSED_KEY = "sidebarCollapsed";

function ReferralButton({ uid, collapsed }: { uid: string; collapsed: boolean }) {
  const [copied, setCopied] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoPos, setInfoPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Positioned via a fixed-coordinate portal-less panel (not a plain CSS absolute popover) because
  // the sidebar's overflow-y-auto implicitly clips horizontal overflow too, which would cut off a
  // popover anchored to the right of a narrow (or collapsed, icon-only) sidebar.
  function openInfo() {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      setInfoPos({ top: rect.top, left: Math.min(rect.right + 8, window.innerWidth - 300) });
    }
    setInfoOpen(true);
  }

  function closeInfoSoon(delay = 150) {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setInfoOpen(false), delay);
  }

  async function handleClick() {
    // Also opens (briefly) on click, not just hover — the only way touch/mobile users, who can't
    // hover, get to see the explanation at all.
    openInfo();
    closeInfoSoon(4000);
    try {
      await navigator.clipboard.writeText(referralLinkFor(uid));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard access can fail (permissions, insecure context) — nothing destructive to recover from, just don't show "Copied".
    }
  }

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  return (
    <>
      <button
        ref={buttonRef}
        onClick={handleClick}
        onMouseEnter={openInfo}
        onMouseLeave={() => closeInfoSoon()}
        aria-label="Invite a friend and earn a free month"
        className={cn(
          "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground/80 transition-colors hover:bg-surface-hover",
          collapsed && "justify-center",
        )}
      >
        {copied ? <Check className="h-4 w-4 shrink-0 text-positive" /> : <Gift className="h-4 w-4 shrink-0 text-muted-foreground" />}
        {!collapsed && <span>{copied ? "Link copied!" : "Invite & earn a free month"}</span>}
      </button>
      {infoOpen && infoPos && (
        <div
          className="fixed z-50 w-72 rounded-md border border-border bg-surface p-3 text-xs shadow-md"
          style={{ top: infoPos.top, left: infoPos.left }}
          onMouseEnter={() => hideTimer.current && clearTimeout(hideTimer.current)}
          onMouseLeave={() => closeInfoSoon()}
        >
          <p className="font-semibold text-foreground">How referrals work</p>
          <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-muted-foreground">
            <li>Click the button to copy your personal invite link.</li>
            <li>Share it — anyone who signs up through that link is credited to you.</li>
            <li>When their free trial converts into a paid subscription, your next month is free automatically — no code to redeem.</li>
          </ol>
        </div>
      )}
    </>
  );
}

interface SidebarContentProps {
  onNavigate?: () => void;
  /** Icon-only rail mode — only applies to the desktop sidebar; the mobile drawer never collapses. */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

function SidebarContent({ onNavigate, collapsed = false, onToggleCollapse }: SidebarContentProps) {
  const { user, subscribed, signOut } = useAuth();

  return (
    <div className="flex h-full flex-col px-3 py-4">
      <div className="flex items-center gap-1">
        <Link
          to="/rankings"
          className={cn(
            "flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-hover",
            collapsed && "justify-center",
          )}
          onClick={onNavigate}
          title={collapsed ? "Analects 2.17" : undefined}
        >
          <Logo className="h-4 w-4 shrink-0" />
          {!collapsed && <span className="text-sm font-semibold">Analects 2.17</span>}
        </Link>
        {onToggleCollapse && !collapsed && (
          <button
            onClick={onToggleCollapse}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground"
          >
            <ChevronsLeft className="h-4 w-4" />
          </button>
        )}
      </div>
      {onToggleCollapse && collapsed && (
        <button
          onClick={onToggleCollapse}
          aria-label="Expand sidebar"
          title="Expand sidebar"
          className="mt-1 flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground"
        >
          <ChevronsRight className="h-4 w-4" />
        </button>
      )}

      <nav className="mt-4 flex flex-col gap-0.5">
        {NAV_LINKS.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end
            onClick={onNavigate}
            title={collapsed ? link.label : undefined}
            className={({ isActive }: { isActive: boolean }) =>
              cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground/80 transition-colors hover:bg-surface-hover",
                collapsed && "justify-center",
                isActive && "bg-surface-hover font-medium text-foreground",
              )
            }
          >
            <link.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            {!collapsed && link.label}
          </NavLink>
        ))}
        {user && <ReferralButton uid={user.uid} collapsed={collapsed} />}
      </nav>

      <div className="mt-auto flex flex-col gap-2 border-t border-border pt-3">
        {user ? (
          <>
            {!subscribed && (
              <Link
                to="/billing"
                onClick={onNavigate}
                title={collapsed ? "Start free trial" : undefined}
                className="rounded-md bg-accent px-2 py-1.5 text-center text-sm font-medium text-accent-foreground hover:opacity-90"
              >
                {collapsed ? "🎟" : "Start free trial"}
              </Link>
            )}
            <div className={cn("flex items-center gap-2 rounded-md px-2 py-1.5", collapsed && "justify-center")}>
              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt=""
                  title={collapsed ? user.email ?? undefined : undefined}
                  className="h-6 w-6 shrink-0 rounded-full"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <UserIcon className="h-6 w-6 shrink-0 rounded-full bg-surface-muted p-1" />
              )}
              {!collapsed && <span className="truncate text-xs text-muted-foreground">{user.email}</span>}
              {!collapsed && (
                <button
                  onClick={() => signOut()}
                  className="ml-auto text-muted-foreground hover:text-foreground"
                  aria-label="Sign out"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </>
        ) : (
          <Link
            to="/login"
            onClick={onNavigate}
            title={collapsed ? "Sign in" : undefined}
            className="rounded-md bg-accent px-2 py-1.5 text-center text-sm font-medium text-accent-foreground hover:opacity-90"
          >
            {collapsed ? "→" : "Sign in"}
          </Link>
        )}
      </div>
    </div>
  );
}

export function Shell() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  });
  const location = useLocation();

  // Close the mobile nav automatically whenever the route changes.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  }, [collapsed]);

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col overflow-y-auto border-r border-border bg-sidebar transition-[width] duration-200 md:flex",
          collapsed ? "w-16" : "w-60",
        )}
      >
        <SidebarContent collapsed={collapsed} onToggleCollapse={() => setCollapsed((c) => !c)} />
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
          <Link to="/rankings" className="flex items-center gap-2">
            <Logo className="h-4 w-4 shrink-0" />
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
