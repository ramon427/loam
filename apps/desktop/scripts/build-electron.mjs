import { build } from "esbuild";
import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { thirdPartyLicenses } from "./thirdPartyLicenses.ts";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * Bundles each plugin that ships with the app (plugins/<id>/src/main.tsx) into
 * dist-electron/plugins/<id>, next to its manifest, where the main process lists them.
 */
const buildBundledPlugins = async ({ mode }) => {
  const output = `${appRoot}/dist-electron/plugins`;
  await rm(output, { recursive: true, force: true });
  const folders = await readdir(`${appRoot}/plugins`, { withFileTypes: true }).catch(() => []);
  await Promise.all(
    folders
      .filter((folder) => folder.isDirectory())
      .map(async ({ name }) => {
        await mkdir(`${output}/${name}`, { recursive: true });
        await copyFile(
          `${appRoot}/plugins/${name}/manifest.json`,
          `${output}/${name}/manifest.json`,
        );
        await build({
          entryPoints: [`${appRoot}/plugins/${name}/src/main.tsx`],
          outfile: `${output}/${name}/main.js`,
          bundle: true,
          format: "esm",
          target: "es2022",
          jsxFactory: "h",
          jsxFragment: "Fragment",
          minify: mode === "production",
          logLevel: "warning",
        });
      }),
  );
};

/** Bundles the main and preload processes and the bundled plugins; the renderer is built by Vite. */
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
  await buildBundledPlugins({ mode });
  const inputs = results.flatMap(({ metafile }) => Object.keys(metafile.inputs));
  await writeFile(`${appRoot}/dist-electron/THIRD_PARTY_LICENSES.txt`, thirdPartyLicenses(inputs));
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildElectron();
}
