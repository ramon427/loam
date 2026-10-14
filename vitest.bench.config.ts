import { defineConfig } from "vitest/config";

import { workspaceAliases } from "./scripts/workspaceAliases.ts";

/** `npm run bench`: slow, one-shot timings kept out of the normal test run. */
export default defineConfig({
  resolve: { alias: workspaceAliases },
  test: {
    environment: "node",
    include: ["bench/**/*.bench.test.ts"],
    testTimeout: 30 * 60 * 1000,
    fileParallelism: false,
  },
});
