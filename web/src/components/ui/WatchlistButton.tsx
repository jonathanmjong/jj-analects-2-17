import { Star } from "lucide-react";
import { useState } from "react";
import { useAuth } from "../../context/AuthProvider";
import { useUserProfile } from "../../hooks/useUserProfile";
import { useWatchlist } from "../../hooks/useWatchlist";
import { cn } from "../../lib/utils";

export function WatchlistButton({ ticker, className }: { ticker: string; className?: string }) {
  const { user } = useAuth();
  const { watchlist } = useUserProfile();
  const { addToWatchlist, removeFromWatchlist } = useWatchlist();
  const [pending, setPending] = useState(false);

  if (!user) return null;

  const symbol = ticker.toUpperCase();
  const isWatched = watchlist.includes(symbol);

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setPending(true);
    try {
      if (isWatched) await removeFromWatchlist(symbol);
      else await addToWatchlist(symbol);
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={pending}
      aria-label={isWatched ? `Remove ${symbol} from watchlist` : `Add ${symbol} to watchlist`}
      aria-pressed={isWatched}
      className={cn("rounded p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground", className)}
    >
      <Star className={cn("h-4 w-4", isWatched && "fill-accent text-accent")} />
    </button>
  );
}
