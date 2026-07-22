import { build, context } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes("--watch");

/**
 * Cloud Functions deploys package only this `functions/` directory and run
 * `npm install` against the public registry in an isolated Cloud Build
 * environment — it has no notion of our local npm workspace, so
 * `@proverbs/shared` (never published) can't be installed there. Bundling
 * its source directly into lib/index.js via this alias removes the runtime
 * dependency entirely; true third-party packages stay external and are
 * installed normally from functions/package.json "dependencies".
 */
const options = {
  entryPoints: [path.join(__dirname, "src/index.ts")],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: path.join(__dirname, "lib/index.js"),
  sourcemap: true,
  logLevel: "info",
  external: ["firebase-admin", "firebase-functions", "stripe", "express", "undici"],
  alias: {
    "@proverbs/shared": path.join(__dirname, "../shared/src/index.ts"),
  },
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
