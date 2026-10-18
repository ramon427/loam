import { defineConfig } from "vitest/config";

import { workspaceAliases } from "./scripts/workspaceAliases.ts";

export default defineConfig({
  resolve: { alias: workspaceAliases },
  test: {
    environment: "node",
    setupFiles: ["apps/desktop/src/renderer/testing/vitestSetup.ts"],
    testTimeout: 30_000,
    include: [
      "packages/*/src/**/*.test.{ts,tsx}",
      "apps/*/src/**/*.test.{ts,tsx}",
      "apps/*/plugins/*/src/**/*.test.ts",
    ],
  },
});
