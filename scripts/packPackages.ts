/**
 * Builds the packages other apps install (@loam/shared, @loam/transfer, @loam/storage,
 * @loam/notes-ui) and packs each into release/packages/<name>-<version>.tgz. Every source
 * file becomes its own ES module in dist/, so `@loam/<package>/<path>` imports work the same
 * outside this repo; notes-ui's styles, CSS modules included, become dist/style.css. A host
 * app's storage uses @loam/storage's note rules (patches, layouts, search) on its own rows.
 *
 * The packages share the desktop app's version. Libraries that hold app-wide state (React,
 * BlockNote, tiptap, React Query, React Flow, Framer Motion) are peer dependencies over their
 * compatible range, so the host app's single copy is used; the rest are dependencies at this
 * repo's exact versions.
 *
 *   node scripts/packPackages.ts
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { build, type Plugin } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const out = path.join(root, "release/packages");
const typesOut = path.join(root, "tmp/package-types");

const PACKAGES = ["shared", "transfer", "storage", "notes-ui"] as const;
const PEERS = [
  /^react$/,
  /^react-dom$/,
  /^@blocknote\//,
  /^@tiptap\//,
  /^@tanstack\/react-query$/,
  /^@xyflow\/react$/,
  /^framer-motion$/,
];

/** Every version semver calls compatible with `pinned`: the same major, or minor before 1.0. */
const compatibleRange = (pinned: string) => {
  const [major, minor] = pinned.split(".");
  return major === "0" ? `~0.${minor}.0` : `^${major}.0.0`;
};

const readJson = <T>(file: string) => JSON.parse(readFileSync(file, "utf8")) as T;
const rootManifest = readJson<{
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}>(path.join(root, "package.json"));
const { version } = readJson<{ version: string }>(path.join(root, "apps/desktop/package.json"));

const isSource = (file: string) =>
  /\.(ts|tsx)$/.test(file) &&
  !file.endsWith(".d.ts") &&
  !file.split(path.sep).some((part) => part === "__tests__" || part === "testing") &&
  !/\.test\.tsx?$/.test(file);

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

/** The npm package a bare import names: `@scope/name` or `name`. */
const packageOf = (specifier: string) => {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
};
const isBare = (id: string) => !id.startsWith(".") && !path.isAbsolute(id) && !id.startsWith("\0");

const STYLES_ENTRY = "loam-library-styles";
const stylesEntry = (stylesheet: string): Plugin => ({
  name: "loam-library-styles",
  resolveId: (id) => (id === STYLES_ENTRY ? id : null),
  load: (id) => (id === STYLES_ENTRY ? `import ${JSON.stringify(stylesheet)};` : null),
});

const buildPackage = async (name: (typeof PACKAGES)[number]) => {
  const dir = path.join(root, "packages", name);
  const src = path.join(dir, "src");
  const dist = path.join(out, name);
  const entries = walk(src).filter(isSource);
  // A CSS file can't be an entry of a build that puts all CSS in one file, so a stub module
  // imports the stylesheet; the stub is deleted after the build.
  const styles = name === "notes-ui";
  if (styles) entries.push(STYLES_ENTRY);
  const imported = new Set<string>();

  await build({
    configFile: false,
    root: dir,
    logLevel: "warn",
    plugins: styles ? [react(), stylesEntry(path.join(src, "styles/library.css"))] : [],
    css: { postcss: path.join(root, "apps/desktop") },
    build: {
      outDir: path.join(dist, "dist"),
      emptyOutDir: true,
      minify: false,
      sourcemap: true,
      cssCodeSplit: false,
      modulePreload: false,
      rollupOptions: {
        input: entries,
        preserveEntrySignatures: "strict",
        external: (id) => {
          if (!isBare(id) || id === STYLES_ENTRY) return false;
          if (!id.startsWith("@loam/")) imported.add(packageOf(id.split("?")[0]));
          return true;
        },
        output: {
          format: "es",
          preserveModules: true,
          preserveModulesRoot: src,
          entryFileNames: "[name].js",
          assetFileNames: (asset) =>
            asset.names.some((file) => file.endsWith(".css"))
              ? "style.css"
              : "assets/[name][extname]",
        },
      },
    },
  });

  if (styles) rmSync(path.join(dist, "dist/_virtual", `${STYLES_ENTRY}.js`), { force: true });
  cpSync(path.join(typesOut, name, "src"), path.join(dist, "dist"), { recursive: true });

  const own = readJson<{ description: string; dependencies?: Record<string, string> }>(
    path.join(dir, "package.json"),
  );
  const dependencies: Record<string, string> = {};
  const peerDependencies: Record<string, string> = {};
  const optionalPeers: string[] = [];
  for (const loam of Object.keys(own.dependencies ?? {})) dependencies[loam] = version;
  // react-data-grid imports ecij without declaring it.
  if (imported.has("react-data-grid")) imported.add("ecij");
  for (const dependency of [...imported].sort()) {
    if (dependency.startsWith("node:")) continue;
    // Only the host conformance tests import Vitest, in the host's own test run.
    if (dependency === "vitest") {
      peerDependencies.vitest = compatibleRange(rootManifest.devDependencies.vitest!);
      optionalPeers.push("vitest");
      continue;
    }
    const pinned = rootManifest.dependencies[dependency];
    if (!pinned) throw new Error(`${name} imports ${dependency}, which package.json doesn't list.`);
    if (PEERS.some((peer) => peer.test(dependency)))
      peerDependencies[dependency] = compatibleRange(pinned);
    else dependencies[dependency] = pinned;
  }
  const manifest = {
    name: `@loam/${name}`,
    version,
    description: own.description,
    license: "MIT",
    type: "module",
    repository: { type: "git", url: "git+https://github.com/ramon427/loam.git" },
    sideEffects: ["*.css"],
    exports: {
      ...(name === "notes-ui" && { "./style.css": "./dist/style.css" }),
      "./*": { types: "./dist/*.d.ts", default: "./dist/*.js" },
    },
    dependencies,
    ...(Object.keys(peerDependencies).length > 0 && { peerDependencies }),
    ...(optionalPeers.length > 0 && {
      peerDependenciesMeta: Object.fromEntries(
        optionalPeers.map((peer) => [peer, { optional: true }]),
      ),
    }),
  };
  writeFileSync(path.join(dist, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  cpSync(path.join(root, "LICENSE"), path.join(dist, "LICENSE"));
  execFileSync("npm", ["pack", "--pack-destination", out, "--silent"], {
    cwd: dist,
    stdio: "inherit",
  });
};

rmSync(out, { recursive: true, force: true });
rmSync(typesOut, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execFileSync("npx", ["tsc", "-p", "tsconfig.packages.json"], { cwd: root, stdio: "inherit" });
for (const name of PACKAGES) await buildPackage(name);
