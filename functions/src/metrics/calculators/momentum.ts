import type { MetricCalculator } from "../types.js";

export const return12m1m: MetricCalculator = (i) => i.momentum?.return12m1m ?? null;
export const riskAdjusted3m: MetricCalculator = (i) => i.momentum?.riskAdjusted3m ?? null;
export const riskAdjusted6m: MetricCalculator = (i) => i.momentum?.riskAdjusted6m ?? null;
