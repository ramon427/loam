import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests drive the built desktop app; `npm run e2e` builds it first.
 * On Linux without a display, run them under `xvfb-run -a`.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Each test runs its own app on its own data folder, so several run at once.
  workers: process.env.LOAM_E2E_WORKERS ?? "50%",
  // A test that passes only on its retry is reported as flaky, not hidden.
  retries: 1,
  reporter: [["list"]],
  projects: [
    { name: "app", grepInvert: /@desktop/ },
    // Tests using the one clipboard or mouse run alone, after the rest.
    { name: "desktop", grep: /@desktop/, workers: 1, dependencies: ["app"] },
  ],
  outputDir: "../tmp/e2e-results",
});
