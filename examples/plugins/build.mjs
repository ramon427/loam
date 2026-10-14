// Bundles each example plugin's src/main.tsx into the main.js its manifest names.
import { readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));

for (const name of readdirSync(root, { withFileTypes: true })) {
  const entry = join(root, name.name, "src", "main.tsx");
  if (!name.isDirectory() || !existsSync(entry)) continue;
  await build({
    entryPoints: [entry],
    outfile: join(root, name.name, "main.js"),
    bundle: true,
    format: "esm",
    target: "es2022",
    jsxFactory: "h",
    jsxFragment: "Fragment",
    logLevel: "warning",
  });
  console.log(`Built ${name.name}/main.js`);
}
