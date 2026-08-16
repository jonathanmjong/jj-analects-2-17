import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Vendor chunking. Left to itself the bundler puts every @firebase/* product in
 * one ~590kB chunk — over the 500kB warning threshold, and a single cache entry
 * that a version bump of any one product invalidates. Splitting per product (and
 * pulling recharts out of the pages that use it) keeps each chunk under the
 * threshold and lets a browser reuse the parts that didn't change.
 */
function vendorChunk(id: string): string | undefined {
  if (!id.includes("node_modules")) return undefined;
  if (id.includes("@firebase/firestore") || id.includes("firebase/firestore")) return "firebase-firestore";
  if (id.includes("@firebase/auth") || id.includes("firebase/auth")) return "firebase-auth";
  if (id.includes("@firebase/storage") || id.includes("firebase/storage")) return "firebase-storage";
  if (id.includes("@firebase/functions") || id.includes("firebase/functions")) return "firebase-functions";
  if (id.includes("@firebase/") || id.includes("/firebase/")) return "firebase-core";
  // Everything else is left to the bundler's automatic chunking, which already
  // splits recharts, xlsx and @tanstack along the lazy-route boundaries that
  // actually load them — grouping those by hand made pages download parts of a
  // library they don't use (measured: +114kB on the Rankings route for recharts,
  // and react-table on the landing page for @tanstack).
  return undefined;
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: { manualChunks: vendorChunk },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
