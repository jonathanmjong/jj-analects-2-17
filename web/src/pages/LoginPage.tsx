import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthProvider";
import { Button } from "../components/ui/Button";
import { Card, CardContent } from "../components/ui/Card";
import { RankedTableMockup, WeightSlidersMockup } from "../components/landing/Mockups";

export function LoginPage() {
  const { user, loading, signInWithGoogle } = useAuth();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);

  if (!loading && user) {
    const from = (location.state as { from?: Location })?.from;
    return <Navigate to={from?.pathname ?? "/billing"} replace />;
  }

  return (
    <div className="mx-auto grid max-w-4xl items-center gap-12 py-16 md:grid-cols-2">
      <div className="flex flex-col items-center text-center md:items-start md:text-left">
        <h1 className="text-3xl font-semibold tracking-tight">Sign in to Analects 2.17</h1>
        <p className="mt-3 text-muted-foreground">
          A multi-factor ranking model across valuation, profitability, growth, financial strength, capital
          allocation, and earnings quality for every mid and large-cap company.
        </p>
        <Card className="mt-8 w-full max-w-md">
          <CardContent className="flex flex-col items-center gap-4 pt-5">
            <Button size="lg" className="w-full" onClick={() => signInWithGoogle().catch((e) => setError(e.message))}>
              Continue with Google
            </Button>
            {error && <p className="text-sm text-negative">{error}</p>}
            <p className="text-xs text-muted-foreground">7-day free trial, then $2/month. Cancel anytime.</p>
          </CardContent>
        </Card>
      </div>

      <div className="relative hidden md:block">
        <div className="pointer-events-none absolute -inset-x-4 -inset-y-8 -z-10 bg-[radial-gradient(ellipse_70%_60%_at_50%_40%,color-mix(in_srgb,var(--color-accent)_10%,transparent),transparent)]" />
        <div className="flex flex-col gap-5">
          <RankedTableMockup />
          <WeightSlidersMockup />
        </div>
      </div>
    </div>
  );
}
