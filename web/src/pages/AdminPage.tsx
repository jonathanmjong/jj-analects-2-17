import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthProvider";
import { functions } from "../lib/firebase";
import { Button } from "../components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";

const ADMIN_EMAILS = ["jonathanmjong@gmail.com"];

export function AdminPage() {
  const { user } = useAuth();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!user || !ADMIN_EMAILS.includes(user.email ?? "")) {
    return <Navigate to="/" replace />;
  }

  async function run(fnName: "seedMetricDefinitions" | "bootstrapSeedUniverse") {
    setBusy(true);
    setStatus(`Running ${fnName}…`);
    try {
      const fn = httpsCallable(functions, fnName);
      const result = await fn();
      setStatus(`${fnName} succeeded: ${JSON.stringify(result.data)}`);
    } catch (e) {
      setStatus(`${fnName} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-2xl font-semibold">Admin tools</h1>
      <Card>
        <CardHeader>
          <CardTitle>One-time / operational jobs</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 pt-2">
          <Button variant="outline" disabled={busy} onClick={() => run("seedMetricDefinitions")}>
            Seed metric definitions
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => run("bootstrapSeedUniverse")}>
            Bootstrap seed universe (fundamentals + prices + rankings)
          </Button>
          {status && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{status}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
