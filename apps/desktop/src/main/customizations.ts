import { watch, type FSWatcher } from "node:fs";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";

import { shell } from "electron";

import type {
  BridgeCustomizations,
  BridgeCustomizationKind,
  BridgeThemeFile,
} from "@loam/shared/bridge/loamBridge";
import { themeManifestSchema } from "@loam/shared/themes/themeSchema";

/** More than anyone keeps by hand; a folder past it is read up to here, in name order. */
const MAX_FILES = 200;
const MAX_FILE_BYTES = 256 * 1024;
const CHANGE_DELAY_MS = 150;

const EXTENSIONS: Record<BridgeCustomizationKind, string> = { themes: ".json", snippets: ".css" };

/**
 * The theme files and CSS snippets in the library's data folder: `themes/*.json` and
 * `snippets/*.css`. Files are read directly from each folder, not from folders inside it, and
 * the window is told when either folder changes so edits show as they are saved.
 */
export const createCustomizations = ({
  dataDirectory,
  onChange,
}: {
  dataDirectory: string;
  onChange: () => void;
}) => {
  const folder = (kind: BridgeCustomizationKind) => join(dataDirectory, kind);

  const readFiles = async (kind: BridgeCustomizationKind) => {
    const entries = await readdir(folder(kind), { withFileTypes: true }).catch(() => []);
    const names = entries
      .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === EXTENSIONS[kind])
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, MAX_FILES);
    const files = await Promise.all(
      names.map(async (file) => {
        const path = join(folder(kind), file);
        try {
          if ((await stat(path)).size > MAX_FILE_BYTES)
            return { file, error: "The file is over 256 KB." };
          return { file, text: await readFile(path, "utf8") };
        } catch {
          return { file, error: "The file could not be read." };
        }
      }),
    );
    return files;
  };

  const readTheme = (file: string, text: string): BridgeThemeFile => {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { file, ok: false, error: "The file is not valid JSON." };
    }
    const parsed = themeManifestSchema.safeParse(json);
    if (parsed.success) return { file, ok: true, theme: parsed.data };
    const issue = parsed.error.issues[0];
    const where = issue?.path.join(".");
    return {
      file,
      ok: false,
      error: `${where ? `${where}: ` : ""}${issue?.message ?? "Invalid theme."}`,
    };
  };

  let watchers: FSWatcher[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const changed = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, CHANGE_DELAY_MS);
  };

  return {
    async list(): Promise<BridgeCustomizations> {
      const [themes, snippets] = await Promise.all([readFiles("themes"), readFiles("snippets")]);
      return {
        themes: themes.map((entry) =>
          "text" in entry && entry.text !== undefined
            ? readTheme(entry.file, entry.text)
            : { file: entry.file, ok: false, error: entry.error ?? "The file could not be read." },
        ),
        snippets: snippets.flatMap((entry) =>
          "text" in entry && entry.text !== undefined
            ? [{ file: entry.file, css: entry.text }]
            : [],
        ),
      };
    },

    /** Opens a folder in the file manager, making it first if it isn't there yet. */
    async reveal(kind: BridgeCustomizationKind) {
      await mkdir(folder(kind), { recursive: true });
      await shell.openPath(folder(kind));
      this.watch();
    },

    /** Starts watching both folders, making them so there is something to watch. */
    watch() {
      for (const watcher of watchers) watcher.close();
      watchers = [];
      for (const kind of ["themes", "snippets"] as const) {
        try {
          watchers.push(watch(folder(kind), changed));
        } catch {
          // A folder that can't be watched is still read when the window asks.
        }
      }
    },

    async start() {
      await Promise.all([
        mkdir(folder("themes"), { recursive: true }),
        mkdir(folder("snippets"), { recursive: true }),
      ]).catch(() => undefined);
      this.watch();
    },

    close() {
      clearTimeout(timer);
      for (const watcher of watchers) watcher.close();
      watchers = [];
    },
  };
};

export type Customizations = ReturnType<typeof createCustomizations>;
