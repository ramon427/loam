import { z } from "zod";

import type { BridgeImportNote, BridgeImportSkip } from "@loam/shared/bridge/loamBridge";

import { exportScopeSchema, importSourceSchema } from "../requests/params";
import { pathSchema } from "./schemas";
import type { ToolContext, ToolDefinition } from "./tools";

/** Tools for requests the window answers with a dialog: AI clients name the paths instead. */
export const pathTools = ({ app, define, withNotes }: ToolContext): ToolDefinition[] => [
  define(
    "loam_export_markdown",
    "Export one note or the whole library as an Obsidian-compatible Markdown vault, with images and JSON Canvas diagrams, into a fresh subfolder of parentDirectory.",
    { scope: exportScopeSchema, parentDirectory: pathSchema },
    async ({ scope, parentDirectory }) => ({
      status: "done",
      ...(await app.gate.library().exporter.run(scope, parentDirectory)),
    }),
    withNotes,
  ),
  define(
    "loam_backups_restore_file",
    "Restore an absolute .json.gz backup file, replacing the library after a safety backup and restarting the app.",
    { path: pathSchema, secret: z.string().min(1).max(1024).optional() },
    async ({ path, secret }) => ({
      status: "restored",
      ...(await app.gate.library().backups.restore({ path }, secret)),
    }),
    { destructive: true, flushFirst: true },
  ),
  define(
    "loam_sync_choose_folder",
    "Enable sync through an absolute local folder managed by a cloud drive or Syncthing.",
    { folder: pathSchema },
    async ({ folder }) => ({
      status: "chosen",
      sync: await app.gate.library().sync.useFolder(folder),
    }),
    withNotes,
  ),
  define(
    "loam_security_save_recovery_key",
    "Save the pending recovery key to a new absolute local file. Existing files are not overwritten.",
    { path: pathSchema },
    async ({ path }) => {
      await app.encryption.saveRecoveryKey(path, { replace: false });
      return { status: "saved" };
    },
  ),
  define(
    "loam_import_run",
    "Import a Markdown/Obsidian folder, Evernote exports, a Notion ZIP or HTML files end to end using the app's own converters, with links, images, diagrams, tables and folder structure.",
    { source: importSourceSchema, paths: z.array(pathSchema).min(1).max(10_000) },
    async ({ source, paths }) => {
      const { importer } = app.gate.library();
      const picked = await importer.pick(source, paths, "ai");
      if (picked.status !== "picked") return picked;
      let written = 0;
      try {
        // The window runs the app's own converters; it answers with the notes they made.
        const converted = (await app.workspace.request({
          action: "convertImport",
          source,
          sessionId: picked.sessionId,
          files: picked.files,
        })) as { notes: BridgeImportNote[]; skipped: BridgeImportSkip[] };
        for (; written < converted.notes.length; written += 100)
          await importer.write(picked.sessionId, converted.notes.slice(written, written + 100));
        return {
          ...(await importer.finish(picked.sessionId)),
          skipped: [...picked.skipped, ...converted.skipped],
        };
      } catch (error) {
        // Place what was written and end the session, so nothing is left half imported.
        await importer.finish(picked.sessionId).catch(() => undefined);
        throw error;
      }
    },
  ),
];
