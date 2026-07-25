import { Navigate } from "react-router-dom";
import { useAuth } from "../../context/AuthProvider";
import { Spinner } from "../ui/Spinner";
import { LandingPage } from "../../pages/LandingPage";

/**
 * "/" is public marketing copy for anonymous visitors, but a returning
 * signed-in user shouldn't have to click through it every time — this
 * resolves it based on auth state instead of being a plain route.
 */
export function RootRoute() {
  const { user, loading, subscribed } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!user) return <LandingPage />;
  if (!subscribed) return <Navigate to="/billing" replace />;
  return <Navigate to="/rankings" replace />;
}
