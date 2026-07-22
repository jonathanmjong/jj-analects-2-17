import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthProvider";
import { Spinner } from "../ui/Spinner";

/** Gates every data page behind "logged in + trialing/active Stripe subscription". */
export function RequireSubscription() {
  const { user, loading, subscribed } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!subscribed) {
    return <Navigate to="/billing" state={{ from: location }} replace />;
  }

  return <Outlet />;
}
