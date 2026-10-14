import { createHash } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join } from "node:path";

import { shell } from "electron";
import { z } from "zod";

import {
  MAX_NOTE_MARKDOWN_LENGTH,
  type FileTabKind,
  type NoteFile,
} from "@loam/shared/notes/noteModel";
import { writeFileAtomic } from "@loam/storage/files";
import { StoreError } from "@loam/storage/storeError";

import { readJsonFile, writeJsonFile } from "./jsonFiles";
import type { MediaStore } from "./mediaStore";

const MAX_TAB_FILE_BYTES = 100 * 1024 * 1024;
/** How long a linked file stays quiet before its change is told, so one save is one change. */
const CHANGE_SETTLE_MS = 250;

/** The extensions each kind of file tab opens, and what it calls a file that isn't one. */
export const TAB_FILE_TYPES = {
  pdf: { name: "PDF", extensions: [".pdf"], description: "a PDF" },
  docx: { name: "Word document", extensions: [".docx"], description: "a Word document" },
  markdown: {
    name: "Markdown",
    extensions: [".md", ".markdown", ".txt"],
    description: "a Markdown file",
  },
} as const satisfies Record<
  FileTabKind,
  { name: string; extensions: readonly string[]; description: string }
>;

const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** Whether `bytes` are a file a tab of `kind` shows; a name alone is not trusted. */
const isTabFileOf = (kind: FileTabKind, bytes: Uint8Array) => {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Readers accept a PDF header anywhere in the first kilobyte.
  if (kind === "pdf") return buffer.subarray(0, 1024).includes("%PDF-");
  // A Word document is a zip holding word/document.xml; zips list their entries' names as is.
  if (kind === "docx")
    return buffer.subarray(0, 4).equals(ZIP_SIGNATURE) && buffer.includes("word/document.xml");
  return readText(buffer) !== null;
};

/** UTF-8 text without NULs, or null for anything else. */
const readText = (bytes: Uint8Array) => {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
};

/** The kind of file tab that opens `path`, by its extension, or null. */
const tabFileKindOf = (path: string): FileTabKind | null => {
  const extension = extname(path).toLowerCase();
  const kinds = Object.keys(TAB_FILE_TYPES) as FileTabKind[];
  return (
    kinds.find((kind) =>
      (TAB_FILE_TYPES[kind].extensions as readonly string[]).includes(extension),
    ) ?? null
  );
};

/** The paths in a launch's arguments that a file tab can open, as "Open with" passes them. */
export const openablePathsIn = (args: readonly string[]) =>
  args.filter((arg) => isAbsolute(arg) && tabFileKindOf(arg) !== null);

const notThisKind = (kind: FileTabKind) =>
  new StoreError(`This isn't ${TAB_FILE_TYPES[kind].description}.`, "MEDIA_TYPE_UNSUPPORTED", 415);

/**
 * A path the window names for a tab of `kind`. Files outside the library are
 * read only when their name and bytes are that kind of file, so a window
 * can't read any other file on this computer.
 */
const checkPath = (kind: FileTabKind, path: string) => {
  if (!isAbsolute(path) || path.includes("\0") || tabFileKindOf(path) !== kind)
    throw notThisKind(kind);
  return path;
};

const readChecked = async (kind: FileTabKind, path: string) => {
  checkPath(kind, path);
  let size: number;
  try {
    const info = await stat(path);
    if (!info.isFile()) throw notThisKind(kind);
    size = info.size;
  } catch (error) {
    if (error instanceof StoreError) throw error;
    throw new StoreError("This file isn't there anymore.", "NOT_FOUND", 404);
  }
  if (size > MAX_TAB_FILE_BYTES)
    throw new StoreError("Files must be 100MB or smaller.", "MEDIA_TOO_LARGE", 413);
  const bytes = await readFile(path);
  if (!isTabFileOf(kind, bytes)) throw notThisKind(kind);
  return bytes;
};

const pathHash = (path: string) => createHash("sha256").update(path).digest("hex");

const notLinkedHere = () =>
  new StoreError(
    "This file wasn't linked on this computer. Add it to the tab again to open it.",
    "FORBIDDEN",
    403,
  );

/**
 * The files PDF, Word and Markdown tabs show: copied into the library,
 * Markdown held in the note, or linked where they are on this computer.
 * `deviceId` marks the links made here; `onLinkedFileChange` hears when a
 * watched file changes on disk.
 *
 * A note can name any path (sync, AI clients and the window all write
 * notes), so a linked file is read, written, copied in, opened or watched
 * only when this computer linked that path itself. The paths it linked are
 * kept in `linkedPathsFile`, outside notes, backups and sync, as SHA-256
 * hashes so the list names no file. Without that file, the paths
 * `linkedBefore` names (the links notes held before the list was kept) start
 * the list.
 */
export const createTabFiles = async ({
  media,
  deviceId,
  linkedPathsFile,
  linkedBefore,
  onLinkedFileChange,
}: {
  media: MediaStore;
  deviceId: string;
  linkedPathsFile: string;
  linkedBefore: () => Promise<string[]>;
  onLinkedFileChange: (path: string) => void;
}) => {
  /** Copies of library files opened in another app, which may come back edited. */
  const openedCopies = new Set<string>();
  const watchers = new Map<string, { watcher: FSWatcher; count: number }>();
  let saving: Promise<void> = Promise.resolve();
  /** Writes every path so far, one write at a time. */
  const saveLinked = () => {
    saving = saving
      .catch(() => undefined)
      .then(() => writeJsonFile(linkedPathsFile, [...linkedHere], { private: true }));
    return saving;
  };
  const saved = await readJsonFile(linkedPathsFile).catch(() => []);
  // A list that can't be read trusts no link until it is made again.
  const hashes = z.array(z.string()).safeParse(saved).data ?? [];
  const linkedHere = new Set(saved === null ? (await linkedBefore()).map(pathHash) : hashes);
  if (saved === null) await saveLinked();

  /** The file at `path` as the note keeps it: its bytes copied in, or its text held. */
  const importPath = async (kind: FileTabKind, path: string): Promise<NoteFile> => {
    const bytes = await readChecked(kind, path);
    const name = basename(path);
    if (kind === "markdown") {
      const text = readText(bytes)!;
      if (text.length > MAX_NOTE_MARKDOWN_LENGTH)
        throw new StoreError(
          "This Markdown file is too long to keep in a note; open it as a linked file instead.",
          "MEDIA_TOO_LARGE",
          413,
        );
      return { name, source: { kind: "text", text } };
    }
    const fileName = await media.saveDocument(kind === "pdf" ? ".pdf" : ".docx", bytes);
    return { name, source: { kind: "imported", fileName } };
  };

  /** A linked file's path, when this computer linked it; refuses any other. */
  const linkedPathOf = (file: NoteFile) => {
    const { source } = file;
    if (source.kind !== "referenced")
      throw new StoreError("This tab's file isn't linked.", "VALIDATION_ERROR", 400);
    if (source.computerId !== deviceId)
      throw new StoreError("This file is on another computer.", "NOT_FOUND", 404);
    if (!linkedHere.has(pathHash(source.path))) throw notLinkedHere();
    return source.path;
  };

  /** A tab's file as bytes. */
  const read = async (kind: FileTabKind, file: NoteFile): Promise<Uint8Array> => {
    const { source } = file;
    if (source.kind === "text") return new TextEncoder().encode(source.text);
    if (source.kind === "imported") return media.readDocument(source.fileName);
    return readChecked(kind, linkedPathOf(file));
  };

  /** A link to the file at `path`, which stays where it is, and the kind of tab that shows it. */
  const link = async (path: string): Promise<{ kind: FileTabKind; file: NoteFile }> => {
    const kind = tabFileKindOf(path);
    if (!kind)
      throw new StoreError(
        "Loam opens PDFs, Word documents and Markdown files.",
        "MEDIA_TYPE_UNSUPPORTED",
        415,
      );
    await readChecked(kind, path);
    if (!linkedHere.has(pathHash(path))) {
      linkedHere.add(pathHash(path));
      await saveLinked();
    }
    return {
      kind,
      file: { name: basename(path), source: { kind: "referenced", path, computerId: deviceId } },
    };
  };

  /**
   * The path to open a tab's file at in another app: a linked file where it
   * is, a library file as a copy under its own name.
   */
  const pathToOpen = async (kind: FileTabKind, file: NoteFile): Promise<string> => {
    const { source } = file;
    if (source.kind === "referenced") return checkPath(kind, linkedPathOf(file));
    const name = basename(file.name) || `file${TAB_FILE_TYPES[kind].extensions[0]}`;
    const copy = join(await mkdtemp(join(tmpdir(), "loam-file-")), name);
    await writeFileAtomic(copy, await read(kind, file));
    openedCopies.add(copy);
    return copy;
  };

  return {
    importPath,
    link,

    /**
     * Links each file the system asked the app to open; one that moved or
     * isn't what its name says is skipped.
     */
    async linkOpened(paths: readonly string[]) {
      const opened = [];
      for (const path of paths) opened.push(await link(path).catch(() => null));
      return opened.filter((file) => file !== null);
    },

    /** Copies a linked file into the library, so it is backed up and synced with the note. */
    async copyIn(kind: FileTabKind, file: NoteFile): Promise<NoteFile> {
      if (file.source.kind !== "referenced") return file;
      return { ...(await importPath(kind, linkedPathOf(file))), name: file.name };
    },

    read,

    /** Saves a linked Markdown file's text where it is. */
    async writeMarkdown(file: NoteFile, text: string) {
      const path = linkedPathOf(file);
      // Only a Markdown file already there is replaced; a note can't make files where it names.
      await readChecked("markdown", path);
      await writeFileAtomic(path, text);
    },

    pathToOpen,

    /** Opens a tab's file in the app the system opens it with (see `pathToOpen`). */
    async openExternally(kind: FileTabKind, file: NoteFile) {
      const path = await pathToOpen(kind, file);
      const failure = await shell.openPath(path);
      if (failure) throw new StoreError(failure, "OPEN_FAILED", 500);
      return { path };
    },

    /** A copy `pathToOpen` made, as the tab keeps it after another app edited it. */
    async takeBackCopy(kind: FileTabKind, path: string, name: string): Promise<NoteFile> {
      if (!openedCopies.has(path))
        throw new StoreError("That isn't a copy this tab opened.", "VALIDATION_ERROR", 400);
      return { ...(await importPath(kind, path)), name };
    },

    /** Tells `onLinkedFileChange` when the file at `path` changes, until `unwatch`. */
    watch(kind: FileTabKind, path: string) {
      checkPath(kind, path);
      if (!linkedHere.has(pathHash(path))) throw notLinkedHere();
      const current = watchers.get(path);
      if (current) {
        current.count += 1;
        return;
      }
      // Editors often save by replacing the file, which ends a watch on the file itself.
      let timer: NodeJS.Timeout | undefined;
      try {
        const watcher = watch(dirname(path), (_event, changed) => {
          if (changed !== null && changed !== basename(path)) return;
          clearTimeout(timer);
          timer = setTimeout(() => onLinkedFileChange(path), CHANGE_SETTLE_MS);
        });
        watcher.on("error", () => undefined);
        watchers.set(path, { watcher, count: 1 });
      } catch {
        // A folder that can't be watched just doesn't reload.
      }
    },

    unwatch(path: string) {
      const current = watchers.get(path);
      if (!current) return;
      current.count -= 1;
      if (current.count > 0) return;
      current.watcher.close();
      watchers.delete(path);
    },

    close() {
      for (const { watcher } of watchers.values()) watcher.close();
      watchers.clear();
    },
  };
};
