import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { pluginManifestSchema, type PluginManifest } from "@loam/shared/plugins/pluginManifest";

const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_PLUGIN_FOLDERS = 200;

/** The plugin folders in `folder`, by name: hidden ones are skipped. */
export const pluginFolderNames = async (folder: string) => {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_PLUGIN_FOLDERS);
};

/**
 * The manifest of the plugin in `folder`/`name`, or why it can't be used: a
 * missing, oversized or invalid manifest.json, or one whose id isn't the
 * folder's name.
 */
export const readManifest = async (
  folder: string,
  name: string,
): Promise<{ ok: true; manifest: PluginManifest } | { ok: false; error: string }> => {
  const path = join(folder, name, "manifest.json");
  try {
    if ((await stat(path)).size > MAX_MANIFEST_BYTES)
      return { ok: false, error: "manifest.json is over 64 KB." };
    const parsed = pluginManifestSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue?.path.join(".");
      return {
        ok: false,
        error: `${where ? `${where}: ` : ""}${issue?.message ?? "Invalid manifest."}`,
      };
    }
    if (parsed.data.id !== name)
      return {
        ok: false,
        error: `The folder must be named after the plugin's id, ${parsed.data.id}.`,
      };
    return { ok: true, manifest: parsed.data };
  } catch (error) {
    return {
      ok: false,
      error:
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? "The folder has no manifest.json."
          : "manifest.json is not valid JSON.",
    };
  }
};
