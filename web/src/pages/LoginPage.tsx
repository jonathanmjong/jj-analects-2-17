import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthProvider";
import { Button } from "../components/ui/Button";
import { Card, CardContent } from "../components/ui/Card";

export function LoginPage() {
  const { user, loading, signInWithGoogle } = useAuth();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);

  if (!loading && user) {
    const from = (location.state as { from?: Location })?.from;
    return <Navigate to={from?.pathname ?? "/billing"} replace />;
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-16 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">Sign in to Analects 2.17</h1>
      <p className="mt-3 text-muted-foreground">
        A multi-factor ranking model across valuation, profitability, growth, financial strength, capital
        allocation, and earnings quality for every mid and large-cap company.
      </p>
      <Card className="mt-8 w-full">
        <CardContent className="flex flex-col items-center gap-4 pt-5">
          <Button size="lg" className="w-full" onClick={() => signInWithGoogle().catch((e) => setError(e.message))}>
            Continue with Google
          </Button>
          {error && <p className="text-sm text-negative">{error}</p>}
          <p className="text-xs text-muted-foreground">7-day free trial, then $2/month. Cancel anytime.</p>
        </CardContent>
      </Card>
    </div>
  );
}
