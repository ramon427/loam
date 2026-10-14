import type { PluginManifest, PluginSettingValue } from "./pluginManifest";

/*
 * What crosses between the window and the main process for plugins. A plugin never sees the
 * stored note format: notes reach it as plain text, and it writes Markdown or plain text.
 */

/** A note as a plugin reads it. */
type PluginNote = {
  id: string;
  title: string;
  updatedAt: string;
  folderId: string | null;
  projectId: string | null;
  /** The text of the note's page tabs, blocks on their own lines. */
  text: string;
};

export type PluginNoteSummary = Omit<PluginNote, "text">;

/**
 * The operations a plugin's `$.notes` sends to the main process, each with its params and
 * result. Writes carry blocks the window already parsed from the plugin's Markdown.
 */
export type PluginOps = {
  "notes.get": { params: { noteId: string }; result: PluginNote };
  "notes.list": { params: Record<string, never>; result: PluginNoteSummary[] };
  "notes.search": {
    params: { query: string; limit?: number };
    result: { noteId: string; title: string; snippet: string }[];
  };
  "notes.backlinks": { params: { noteId: string }; result: PluginNoteSummary[] };
  "notes.create": {
    params: { title: string; blocks: unknown[]; folderId?: string | null };
    result: PluginNoteSummary;
  };
  "notes.setTitle": { params: { noteId: string; title: string }; result: PluginNoteSummary };
  "notes.append": { params: { noteId: string; blocks: unknown[] }; result: PluginNoteSummary };
  "notes.trash": { params: { noteId: string }; result: null };
};

export type PluginOp = keyof PluginOps;

/** Which permission each operation needs. */
export const PLUGIN_OP_PERMISSIONS: Record<PluginOp, "notes:read" | "notes:write"> = {
  "notes.get": "notes:read",
  "notes.list": "notes:read",
  "notes.search": "notes:read",
  "notes.backlinks": "notes:read",
  "notes.create": "notes:write",
  "notes.setTitle": "notes:write",
  "notes.append": "notes:write",
  "notes.trash": "notes:write",
};

export const PLUGIN_OPS = Object.keys(PLUGIN_OP_PERMISSIONS) as PluginOp[];

/** A plugin folder as the window lists it. */
export type BridgePluginInfo = {
  /** The folder's name; the manifest's id once it reads. */
  folder: string;
  /** Switched on, with these of its permissions granted. */
  enabled: boolean;
  granted: string[];
  settings: Record<string, PluginSettingValue>;
} & ({ ok: true; manifest: PluginManifest } | { ok: false; error: string });

export type BridgePlugins = {
  /** While on, no plugin runs, whatever is switched on. */
  restrictedMode: boolean;
  plugins: BridgePluginInfo[];
};

export type BridgePluginFetch = {
  status: number;
  headers: Record<string, string>;
  body: string;
};
