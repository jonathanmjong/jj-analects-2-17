import express from "express";
import type { Request, Response, NextFunction } from "express";
import { onRequest } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import { collections } from "../lib/firestore.js";
import { log } from "../lib/logger.js";

const app = express();

/**
 * This endpoint serves the whole ranked universe — the product itself — so it
 * is gated on the same `subscribed` custom claim that firestore.rules and
 * storage.rules check, rather than inventing a second access model (see
 * CLAUDE.md). It previously had no check at all: because Cloud Functions v2
 * needs allUsers:roles/run.invoker to be callable, "no hosting rewrite points
 * at it" was never actually protection, and the raw Cloud Run URL returned
 * every company's scores to anyone who asked.
 *
 * Clients send a Firebase ID token: `Authorization: Bearer <token>`.
 */
export async function requireSubscriber(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.get("authorization") ?? "";
  const match = /^Bearer (.+)$/i.exec(header.trim());
  if (!match) {
    res.status(401).json({ error: "Missing bearer token. Send a Firebase ID token as 'Authorization: Bearer <token>'." });
    return;
  }
  try {
    const token = await getAuth().verifyIdToken(match[1]);
    if (token.subscribed !== true) {
      res.status(403).json({ error: "An active subscription is required for this export." });
      return;
    }
    next();
  } catch (err) {
    // Only the message, never the Error object: verification failures are
    // trivially attacker-triggerable, and logging a full stack per bad token
    // turns that into log spam. The response stays deliberately vague too —
    // distinguishing expired from malformed from wrong-project is information
    // an unauthenticated caller has not earned.
    log.warn(`api: rejected an ID token — ${err instanceof Error ? err.message : "unknown error"}`);
    res.status(401).json({ error: "Invalid or expired token." });
  }
}

app.get("/rankings.:format", requireSubscriber, async (req, res) => {
  const format = req.params.format;
  const snap = await collections.rankingsLatest().orderBy("overallRank", "asc").limit(2000).get();
  const rows = snap.docs.map((d) => {
    const r = d.data();
    return {
      ticker: r.ticker,
      overallRank: r.overallRank,
      overallScore: r.overallScore,
      ...Object.fromEntries((r.categoryScores ?? []).map((c: { category: string; score: number | null }) => [`${c.category}Score`, c.score])),
    };
  });

  if (format === "json") {
    res.json(rows);
    return;
  }

  if (format === "csv") {
    if (rows.length === 0) {
      res.status(200).type("text/csv").send("");
      return;
    }
    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(","),
      ...rows.map((row) => headers.map((h) => JSON.stringify((row as Record<string, unknown>)[h] ?? "")).join(",")),
    ].join("\n");
    res.status(200).type("text/csv").attachment("rankings.csv").send(csv);
    return;
  }

  res.status(400).json({ error: `Unsupported format: ${format}. Use .json or .csv.` });
});

export const api = onRequest(app);
