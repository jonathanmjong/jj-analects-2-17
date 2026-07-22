import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthProvider";
import { functions } from "../lib/firebase";
import { Button } from "../components/ui/Button";
import { Card, CardContent } from "../components/ui/Card";
import { Spinner } from "../components/ui/Spinner";

export function BillingPage() {
  const { user, loading, subscribed } = useAuth();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (subscribed) return <Navigate to="/" replace />;

  async function startTrial() {
    setStarting(true);
    setError(null);
    try {
      const createCheckoutSession = httpsCallable<{ successUrl: string; cancelUrl: string }, { url: string }>(
        functions,
        "createCheckoutSession",
      );
      const result = await createCheckoutSession({
        successUrl: `${window.location.origin}/?checkout=success`,
        cancelUrl: `${window.location.origin}/billing`,
      });
      window.location.href = result.data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong starting checkout.");
      setStarting(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-16 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">Start your 7-day free trial</h1>
      <p className="mt-3 text-muted-foreground">
        Full access to rankings, company pages, compare tools, and exports. $2/month after your trial — cancel
        anytime from the billing portal.
      </p>
      <Card className="mt-8 w-full">
        <CardContent className="flex flex-col items-center gap-4 pt-5">
          <Button size="lg" className="w-full" disabled={starting} onClick={startTrial}>
            {starting ? <Spinner className="border-accent-foreground/40 border-t-accent-foreground" /> : "Start free trial"}
          </Button>
          {error && <p className="text-sm text-negative">{error}</p>}
          <p className="text-xs text-muted-foreground">Payment handled securely by Stripe.</p>
        </CardContent>
      </Card>
    </div>
  );
}
