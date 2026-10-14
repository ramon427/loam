import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const { paths } = JSON.parse(readFileSync(new URL("tsconfig.base.json", root), "utf8"))
  .compilerOptions as { paths: Record<string, [string]> };

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Vite and Vitest aliases for the workspace packages, read from the `paths`
 * in tsconfig.base.json so they are defined in one place.
 */
export const workspaceAliases = Object.entries(paths).map(([pattern, [target]]) => ({
  find: new RegExp(`^${escapeRegExp(pattern.slice(0, -"*".length))}`),
  replacement: fileURLToPath(new URL(target.slice(0, -"*".length), root)),
}));
