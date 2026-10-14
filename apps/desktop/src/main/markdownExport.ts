import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { shell } from "electron";

import type { BridgeExportDone, BridgeExportScope } from "@loam/shared/bridge/loamBridge";
import type { NotesStore } from "@loam/storage/NotesStore";
import { MEDIA_FILE_NAME_PATTERN } from "@loam/shared/notes/mediaFiles";
import { isInsideDirectory } from "@loam/storage/files";
import { StoreError } from "@loam/storage/storeError";
import {
  buildMarkdownExport,
  type MarkdownExportPlan,
} from "@loam/transfer/export/buildMarkdownExport";

import { openMedia, PLAIN_MEDIA, type MediaKeys } from "./mediaStore";

const pad = (value: number) => String(value).padStart(2, "0");

const exportFolderName = (now: Date) =>
  `Loam export ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
  `${pad(now.getHours())}${pad(now.getMinutes())}`;

/** Creates a new folder and never reuses one, so an export can't overwrite anything. */
const createExportDirectory = async (parent: string, now: Date) => {
  const base = exportFolderName(now);
  for (let copy = 1; copy < 100; copy += 1) {
    const directory = join(parent, copy === 1 ? base : `${base} (${copy})`);
    try {
      await mkdir(directory);
      return directory;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error("Could not create a new export folder.");
};

/** Resolves a plan path inside the export folder, refusing anything that escapes it. */
const resolveExportPath = (directory: string, path: string) => {
  const target = resolve(directory, ...path.split("/"));
  if (!isInsideDirectory(directory, target)) {
    throw new Error(`Refusing to write outside the export folder: ${path}`);
  }
  return target;
};

/** Reads the notes the scope covers from the store, in library order. */
const readNotesForExport = async (store: NotesStore, scope: BridgeExportScope) => {
  const library = await store.getLibrary();
  if (scope.kind === "note") {
    const notes = [await store.getNote(scope.noteId)];
    return { notes, folders: [], projects: [], library: library.notes };
  }
  const notes = [];
  for (const { id } of library.notes) notes.push(await store.getNote(id));
  return { notes, folders: library.folders, projects: library.projects, library: library.notes };
};

/** Writes a plan into a new folder under `parentDirectory`. */
export const writeMarkdownExport = async ({
  plan,
  parentDirectory,
  mediaDirectory,
  mediaKeys = PLAIN_MEDIA,
  now = new Date(),
}: {
  plan: MarkdownExportPlan;
  parentDirectory: string;
  mediaDirectory: string;
  /** Opens sealed images: an export is plain files. */
  mediaKeys?: MediaKeys;
  now?: Date;
}): Promise<BridgeExportDone> => {
  const directory = await createExportDirectory(parentDirectory, now);
  let fileCount = 0;
  let missingImages = 0;
  for (const file of plan.files) {
    const target = resolveExportPath(directory, file.path);
    await mkdir(dirname(target), { recursive: true });
    if (file.kind === "text") {
      await writeFile(target, file.content, { flag: "wx" });
      fileCount += 1;
      continue;
    }
    if (!MEDIA_FILE_NAME_PATTERN.test(file.mediaFile)) {
      missingImages += 1;
      continue;
    }
    let bytes: Buffer;
    try {
      bytes = openMedia(
        mediaKeys,
        file.mediaFile,
        await readFile(join(mediaDirectory, file.mediaFile)),
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== undefined && code !== "ENOENT") throw error;
      missingImages += 1;
      continue;
    }
    await writeFile(target, bytes, { flag: "wx" });
    fileCount += 1;
  }
  return { directory, noteCount: plan.noteCount, fileCount, missingImages };
};

/** Reads, converts and writes in one step; the caller has already picked the folder. */
export const exportNotesAsMarkdown = async ({
  store,
  scope,
  parentDirectory,
  mediaDirectory,
  mediaKeys,
}: {
  store: NotesStore;
  scope: BridgeExportScope;
  parentDirectory: string;
  mediaDirectory: string;
  mediaKeys?: MediaKeys;
}) => {
  const { notes, folders, projects, library } = await readNotesForExport(store, scope);
  const plan = buildMarkdownExport({ notes, folders, projects, linkableNotes: library });
  return writeMarkdownExport({ plan, parentDirectory, mediaDirectory, mediaKeys });
};

/**
 * Exports for the window and AI clients, one at a time, remembering the last
 * folder written so the window can reveal it without sending a path.
 */
export const createMarkdownExporter = ({
  store,
  mediaDirectory,
  mediaKeys,
}: {
  store: NotesStore;
  mediaDirectory: string;
  mediaKeys: () => MediaKeys;
}) => {
  let running = false;
  let lastDirectory: string | null = null;
  return {
    async run(scope: BridgeExportScope, parentDirectory: string) {
      if (running) throw new StoreError("An export is already running.", "CONFLICT", 409);
      running = true;
      try {
        const result = await exportNotesAsMarkdown({
          store,
          scope,
          parentDirectory,
          mediaDirectory,
          mediaKeys: mediaKeys(),
        }).catch((error: unknown) => {
          if (error instanceof StoreError) throw error;
          const code = (error as NodeJS.ErrnoException).code ?? "unknown error";
          throw new StoreError(
            `Could not write the export (${code}). Pick a folder you can write to.`,
            "EXPORT_WRITE_FAILED",
            500,
          );
        });
        lastDirectory = result.directory;
        return result;
      } finally {
        running = false;
      }
    },
    /** Opens the folder the last export wrote in the file manager. */
    async reveal() {
      if (lastDirectory) await shell.openPath(lastDirectory);
    },
  };
};
