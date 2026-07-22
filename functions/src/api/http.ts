import express from "express";
import { onRequest } from "firebase-functions/v2/https";
import { collections } from "../lib/firestore.js";

const app = express();

app.get("/rankings.:format", async (req, res) => {
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
