import type { FileFilter } from "electron";

import type { BridgeImportSource } from "@loam/shared/bridge/loamBridge";

/**
 * What each import reads: a folder to scan, files picked one by one, or one
 * zip export; which of their files hold notes; and how the picker asks.
 */
export const IMPORT_SOURCES = {
  markdown: {
    pick: "folder",
    noteExtensions: new Set([".md", ".markdown", ".canvas"]),
    dialog: { title: "Import a Markdown folder or Obsidian vault", filters: [] },
  },
  evernote: {
    pick: "files",
    noteExtensions: new Set([".enex"]),
    dialog: {
      title: "Import Evernote notebooks",
      filters: [{ name: "Evernote export", extensions: ["enex"] }],
    },
  },
  notion: {
    pick: "archive",
    noteExtensions: new Set([".md", ".markdown", ".csv", ".html"]),
    dialog: {
      title: "Import a Notion export",
      filters: [{ name: "Notion export", extensions: ["zip"] }],
    },
  },
  html: {
    pick: "files",
    noteExtensions: new Set([".html", ".htm"]),
    dialog: {
      title: "Import HTML files",
      filters: [{ name: "Web page", extensions: ["html", "htm"] }],
    },
  },
} satisfies Record<
  BridgeImportSource,
  {
    pick: "folder" | "files" | "archive";
    noteExtensions: ReadonlySet<string>;
    dialog: { title: string; filters: FileFilter[] };
  }
>;
