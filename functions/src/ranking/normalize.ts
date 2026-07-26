// Moved to shared/src/rankingMath.ts so the exact same implementation runs
// both here (nightly ranking engine) and client-side (the Rankings page's
// instant live-reweighting preview). Re-exported here to avoid touching
// every existing import site.
export { winsorize, percentileRanks, zscores, zscoreToUnitScore, weightedAverage } from "@proverbs/shared";
