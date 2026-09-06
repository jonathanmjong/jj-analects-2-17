#!/usr/bin/env node
// Thin CLI entrypoint. prerenderMeta.mjs stays import-safe (no side effects on load) so its pure
// functions are unit-testable without running the real build I/O.
import { run } from "./prerenderMeta.mjs";
run();
