import { onSchedule } from "firebase-functions/v2/scheduler";
import { refreshSp500Membership } from "../ingestion/ingestIndexMembership.js";
import { logRefresh } from "../ingestion/ingestFundamentals.js";

export const sp500MembershipRefresh = onSchedule(
  { schedule: "every day 04:00", timeZone: "America/New_York", timeoutSeconds: 300 },
  async () => {
    const startedAt = new Date().toISOString();
    const result = await refreshSp500Membership();
    await logRefresh("sp500_membership", "wikipedia_constituents_table", result, startedAt);
  },
);
