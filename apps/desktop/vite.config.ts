import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

import { workspaceAliases } from "../../scripts/workspaceAliases.ts";
import { thirdPartyLicenses } from "./scripts/thirdPartyLicenses.ts";
import { buildContentSecurityPolicy } from "./src/shared/contentSecurityPolicy";

const DEV_SERVER = { host: "127.0.0.1", port: 5199 };

const contentSecurityPolicyPlugin = (policy: string): Plugin => ({
  name: "loam-content-security-policy",
  transformIndexHtml: (html) => html.replace("%LOAM_CONTENT_SECURITY_POLICY%", policy),
});

/** Writes the notices of every package the window's bundles, its workers' included, contain. */
const thirdPartyLicensesPlugin = (): { app: Plugin; worker: () => Plugin } => {
  const moduleIds = new Set<string>();
  const collect = (bundle: Record<string, { type: string; moduleIds?: string[] }>) => {
    for (const output of Object.values(bundle)) {
      if (output.type === "chunk") for (const id of output.moduleIds ?? []) moduleIds.add(id);
    }
  };
  return {
    app: {
      name: "loam-third-party-licenses",
      apply: "build",
      generateBundle(_options, bundle) {
        collect(bundle);
        this.emitFile({
          type: "asset",
          fileName: "THIRD_PARTY_LICENSES.txt",
          source: thirdPartyLicenses(moduleIds),
        });
      },
    },
    worker: () => ({
      name: "loam-third-party-licenses-worker",
      apply: "build",
      generateBundle: (_options, bundle) => collect(bundle),
    }),
  };
};

const licenses = thirdPartyLicensesPlugin();

export default defineConfig(({ command }) => ({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/",
  publicDir: "public",
  define: {
    // The sandboxed renderer has no `process`; shared code may still read these.
    "process.env.NODE_ENV": JSON.stringify(command === "serve" ? "development" : "production"),
  },
  resolve: { alias: workspaceAliases },
  plugins: [
    contentSecurityPolicyPlugin(
      buildContentSecurityPolicy({
        devServerOrigin:
          command === "serve" ? `http://${DEV_SERVER.host}:${DEV_SERVER.port}` : undefined,
      }),
    ),
    react(),
    licenses.app,
  ],
  server: { ...DEV_SERVER, strictPort: true },
  worker: { format: "es", plugins: () => [licenses.worker()] },
  build: {
    outDir: "dist-renderer",
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
  },
}));
