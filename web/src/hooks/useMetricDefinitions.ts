import { useQuery } from "@tanstack/react-query";
import type { MetricDefinition } from "@proverbs/shared";
import { loadFirestore } from "../lib/firebase";

export function useMetricDefinitions() {
  return useQuery({
    queryKey: ["metric-definitions"],
    queryFn: async () => {
      const [{ collection, getDocs }, db] = await Promise.all([import("../lib/firestore"), loadFirestore()]);
      const snap = await getDocs(collection(db, "metricDefinitions"));
      return snap.docs.map((d) => d.data() as MetricDefinition);
    },
    staleTime: 60 * 60 * 1000,
  });
}
