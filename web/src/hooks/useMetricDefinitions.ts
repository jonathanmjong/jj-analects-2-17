import { useQuery } from "@tanstack/react-query";
import { collection, getDocs } from "firebase/firestore";
import type { MetricDefinition } from "@proverbs/shared";
import { db } from "../lib/firebase";

export function useMetricDefinitions() {
  return useQuery({
    queryKey: ["metric-definitions"],
    queryFn: async () => {
      const snap = await getDocs(collection(db, "metricDefinitions"));
      return snap.docs.map((d) => d.data() as MetricDefinition);
    },
    staleTime: 60 * 60 * 1000,
  });
}
