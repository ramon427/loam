import { build } from "esbuild";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { thirdPartyLicenses } from "./thirdPartyLicenses.ts";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

/** Bundles the main and preload processes; the renderer is built by Vite. */
export const buildElectron = async ({ mode = "production" } = {}) => {
  const shared = {
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node24",
    external: ["electron"],
    sourcemap: mode === "development" ? "inline" : false,
    logLevel: "warning",
    metafile: true,
    // Resolves the workspace packages through the `paths` in tsconfig.base.json.
    tsconfig: `${appRoot}/tsconfig.node.json`,
    define: { "process.env.NODE_ENV": JSON.stringify(mode) },
  };
  const results = await Promise.all([
    build({
      ...shared,
      entryPoints: [`${appRoot}/src/main/main.ts`],
      outfile: `${appRoot}/dist-electron/main.cjs`,
    }),
    build({
      ...shared,
      entryPoints: [`${appRoot}/src/preload/preload.ts`],
      outfile: `${appRoot}/dist-electron/preload.cjs`,
    }),
    build({
      ...shared,
      entryPoints: [`${appRoot}/src/main/mcp/stdio.ts`],
      outfile: `${appRoot}/dist-electron/mcp.cjs`,
    }),
  ]);
  const inputs = results.flatMap(({ metafile }) => Object.keys(metafile.inputs));
  await writeFile(`${appRoot}/dist-electron/THIRD_PARTY_LICENSES.txt`, thirdPartyLicenses(inputs));
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildElectron();
}
