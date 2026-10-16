import type { FileFilter } from "electron";

import type { BridgeImportSource } from "@loam/shared/bridge/loamBridge";

/**
 * What each import reads: a folder to scan, files picked one by one, or one
 * zip export; and which of their files hold notes.
 */
export const IMPORT_SOURCES = {
  markdown: { pick: "folder", noteExtensions: new Set([".md", ".markdown", ".canvas"]) },
  evernote: { pick: "files", noteExtensions: new Set([".enex"]) },
  notion: { pick: "archive", noteExtensions: new Set([".md", ".markdown", ".csv", ".html"]) },
  html: { pick: "files", noteExtensions: new Set([".html", ".htm"]) },
} satisfies Record<
  BridgeImportSource,
  { pick: "folder" | "files" | "archive"; noteExtensions: ReadonlySet<string> }
>;

/** The one import picker's filter: every kind of file an import can start from. */
export const IMPORT_FILE_FILTER: FileFilter = {
  name: "Notes and exports",
  extensions: ["md", "markdown", "canvas", "enex", "zip", "html", "htm"],
};
