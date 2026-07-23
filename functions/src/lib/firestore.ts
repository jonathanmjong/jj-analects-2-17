import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

if (getApps().length === 0) {
  initializeApp();
}

export const db = getFirestore();
export { FieldValue, Timestamp };

export const collections = {
  companies: () => db.collection("companies"),
  company: (ticker: string) => db.collection("companies").doc(ticker.toUpperCase()),
  marketData: (ticker: string) => db.collection("companies").doc(ticker.toUpperCase()).collection("marketData"),
  incomeStatements: (ticker: string) =>
    db.collection("companies").doc(ticker.toUpperCase()).collection("incomeStatements"),
  balanceSheets: (ticker: string) =>
    db.collection("companies").doc(ticker.toUpperCase()).collection("balanceSheets"),
  cashFlowStatements: (ticker: string) =>
    db.collection("companies").doc(ticker.toUpperCase()).collection("cashFlowStatements"),
  historicalMetrics: (ticker: string) =>
    db.collection("companies").doc(ticker.toUpperCase()).collection("historicalMetrics"),
  metricScores: (ticker: string) =>
    db.collection("companies").doc(ticker.toUpperCase()).collection("metricScores"),
  historicalRankings: (ticker: string) =>
    db.collection("historicalRankings").doc(ticker.toUpperCase()).collection("snapshots"),
  metricDefinitions: () => db.collection("metricDefinitions"),
  rankingsLatest: () => db.collection("rankings").doc("latest").collection("companies"),
  rankingConfig: () => db.collection("rankings").doc("config"),
  dataRefreshLogs: () => db.collection("dataRefreshLogs"),
  users: () => db.collection("users"),
};
