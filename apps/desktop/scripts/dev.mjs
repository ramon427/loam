import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

import { buildElectron } from "./build-electron.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const electronBinary = createRequire(import.meta.url)("electron");

const server = await createServer({ configFile: `${appRoot}/vite.config.ts`, mode: "development" });
await server.listen();
const rendererUrl = server.resolvedUrls?.local[0];
if (!rendererUrl) throw new Error("The Vite dev server has no local URL.");
await buildElectron({ mode: "development" });

const electron = spawn(electronBinary, [appRoot, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, LOAM_RENDERER_URL: rendererUrl },
});

const stop = async (code) => {
  await server.close();
  process.exit(code ?? 0);
};
electron.on("exit", (code) => void stop(code));
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => electron.kill(signal));
}
