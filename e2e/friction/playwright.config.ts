import { defineConfig } from "@playwright/test";

/**
 * The friction baseline: each flow does one core job the way a person would today and records
 * its cost to tmp/friction. `npm run friction` builds the app, runs the flows and prints the
 * table next to the committed baseline. Flows run one at a time so their timings compare.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "*.friction.ts",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../tmp/friction-results",
});
