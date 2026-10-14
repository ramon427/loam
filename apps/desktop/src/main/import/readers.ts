import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join } from "node:path";

import type {
  BridgeImportFile,
  BridgeImportImageRequest,
  BridgeImportImageResult,
  BridgeImportSkip,
  BridgeImportSource,
} from "@loam/shared/bridge/loamBridge";
import { isInsideDirectory } from "@loam/storage/files";
import { StoreError } from "@loam/storage/storeError";
import { isImageFilePath, normalizePath } from "@loam/transfer/import/importPaths";

import { IMPORT_SOURCES } from "./sources";
import { listZipEntries, type ZipEntry } from "./zipArchive";

/** Generous for real vaults, small enough that a wrong folder pick fails fast. */
export const IMPORT_LIMITS = {
  files: 10_000,
  entries: 100_000,
  depth: 32,
  fileBytes: 5 * 1024 * 1024,
  totalBytes: 100 * 1024 * 1024,
  imageBytes: 10 * 1024 * 1024,
  skippedListed: 500,
};

/** Evernote exports carry their images inside, so one notebook file can be large. */
const EXPORT_FILE_LIMITS = { fileBytes: 100 * 1024 * 1024, totalBytes: 250 * 1024 * 1024 };
/** A zip export and the part zips inside it, all expanded together. */
const ARCHIVE_BYTES_LIMIT = 1024 * 1024 * 1024;

const SKIPPED_FOLDERS = new Set(["node_modules"]);

/** An image's bytes, or why it was skipped. */
type ImageRead = Uint8Array | BridgeImportImageResult;

/** Where an import's images come from: find the file a note means, then read it. */
export type ImageSource = {
  locate: (request: BridgeImportImageRequest) => Promise<string | null>;
  read: (path: string) => Promise<ImageRead>;
};

/** What an import read from what was picked. */
export type ImportRead = {
  /** The picked folder or file name, for messages. */
  name: string;
  files: BridgeImportFile[];
  skipped: BridgeImportSkip[];
  images: ImageSource;
};

/** Image files found while scanning a folder or archive. */
type ImageIndex = {
  /** Every image file found, keyed by lower-cased relative path. */
  images: Map<string, string>;
  /** Image paths by lower-cased file name, for Obsidian's name-only embeds. */
  imagesByName: Map<string, string[]>;
};

const tooLarge = (message: string) => new StoreError(message, "IMPORT_TOO_LARGE", 413);

/** A relative path with `/` separators, or null when it is empty or climbs out of the root. */
const relativePath = (path: string) => normalizePath(path.replace(/\\/g, "/")) || null;

const sizeLabel = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

/** Lists skipped files up to a limit, then counts the rest in one line. */
const createSkipList = () => {
  const skipped: BridgeImportSkip[] = [];
  let unlisted = 0;
  return {
    add(path: string, reason: string) {
      if (skipped.length < IMPORT_LIMITS.skippedListed) skipped.push({ path, reason });
      else unlisted += 1;
    },
    list: () =>
      unlisted > 0
        ? [...skipped, { path: `${unlisted} more files`, reason: "Not listed" }]
        : skipped,
  };
};

const createImageIndex = (): ImageIndex => ({ images: new Map(), imagesByName: new Map() });

const addImage = (index: ImageIndex, path: string) => {
  index.images.set(path.toLowerCase(), path);
  const name = basename(path).toLowerCase();
  index.imagesByName.set(name, [...(index.imagesByName.get(name) ?? []), path]);
};

const IMAGE_TOO_LARGE = { skipped: "Image is larger than 10 MB" };
const IMAGE_UNREADABLE = { skipped: "Image file could not be read" };

/** A file can move or change between the folder scan and the copy. */
const readImageFile = async (fullPath: string): Promise<ImageRead> => {
  try {
    if ((await stat(fullPath)).size > IMPORT_LIMITS.imageBytes) return IMAGE_TOO_LARGE;
    return new Uint8Array(await readFile(fullPath));
  } catch {
    return IMAGE_UNREADABLE;
  }
};

/** A note's image reference without its query or fragment; converters decode it first. */
const referencePath = (reference: string) => reference.trim().split(/[?#]/)[0]!;

/**
 * Finds the image a note refers to among the files scanned: relative to the
 * note, then from the root, then (like Obsidian) by file name anywhere.
 */
const locateIndexedImage = (
  index: ImageIndex,
  { fromPath, reference }: BridgeImportImageRequest,
) => {
  const cleaned = referencePath(reference);
  const fromDirectory = fromPath.split("/").slice(0, -1).join("/");
  for (const candidate of [relativePath(`${fromDirectory}/${cleaned}`), relativePath(cleaned)]) {
    const found = candidate && index.images.get(candidate.toLowerCase());
    if (found) return found;
  }
  const named = index.imagesByName.get(basename(cleaned).toLowerCase()) ?? [];
  return named.find((path) => path.startsWith(`${fromDirectory}/`)) ?? named[0] ?? null;
};

/** Reads the note files under `root`, without following links out of it. */
const readImportFolder = async (root: string, source: BridgeImportSource): Promise<ImportRead> => {
  const files: BridgeImportFile[] = [];
  const skipped = createSkipList();
  const index = createImageIndex();
  const { noteExtensions } = IMPORT_SOURCES[source];
  let entries = 0;
  let totalBytes = 0;

  const visit = async (directory: string, relative: string, depth: number) => {
    const list = await readdir(directory, { withFileTypes: true });
    list.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of list) {
      entries += 1;
      if (entries > IMPORT_LIMITS.entries)
        throw tooLarge("That folder has too many files to import. Pick a smaller folder.");
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      // Hidden folders hold app settings (.obsidian), trash and version control.
      if (entry.name.startsWith(".") || SKIPPED_FOLDERS.has(entry.name)) continue;
      if (entry.isSymbolicLink()) {
        skipped.add(path, "Links to other places are not followed");
        continue;
      }
      if (entry.isDirectory()) {
        if (depth >= IMPORT_LIMITS.depth) skipped.add(path, "Folder is nested too deeply");
        else await visit(join(directory, entry.name), path, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (isImageFilePath(entry.name)) {
        addImage(index, path);
        continue;
      }
      if (!noteExtensions.has(extname(entry.name).toLowerCase())) {
        skipped.add(path, "Not a note file");
        continue;
      }
      const fullPath = join(directory, entry.name);
      const info = await stat(fullPath);
      if (info.size > IMPORT_LIMITS.fileBytes) {
        skipped.add(path, "Larger than 5 MB");
        continue;
      }
      totalBytes += info.size;
      if (totalBytes > IMPORT_LIMITS.totalBytes || files.length >= IMPORT_LIMITS.files)
        throw tooLarge("That folder is too large to import at once. Pick a smaller folder.");
      files.push({ path, text: await readFile(fullPath, "utf8") });
    }
  };

  const realRoot = await realpath(root);
  await visit(realRoot, "", 0);
  return {
    name: basename(realRoot),
    files,
    skipped: skipped.list(),
    images: {
      locate: async (request) => locateIndexedImage(index, request),
      read: (path) => readImageFile(join(realRoot, ...path.split("/"))),
    },
  };
};

/**
 * Picked files were not scanned with their folders, so an image a page refers
 * to is looked up when asked for: only an image file inside that page's own
 * folder, reached without following a link out of it.
 */
const createPickedFileImageSource = (directoryByName: Map<string, string>): ImageSource => ({
  async locate({ fromPath, reference }) {
    const directory = directoryByName.get(fromPath);
    const cleaned = referencePath(reference);
    const relative = relativePath(cleaned);
    if (!directory || !relative || isAbsolute(cleaned) || /^[a-z][a-z0-9+.-]*:/i.test(cleaned))
      return null;
    if (!isImageFilePath(relative)) return null;
    const candidate = join(directory, ...relative.split("/"));
    try {
      if (!(await lstat(candidate)).isFile()) return null;
      const [real, base] = await Promise.all([realpath(candidate), realpath(directory)]);
      return isInsideDirectory(base, real) ? real : null;
    } catch {
      return null;
    }
  },
  read: readImageFile,
});

/** Reads files the user picked one by one; nothing else in their folders is touched. */
const readImportFiles = async (
  paths: readonly string[],
  source: BridgeImportSource,
): Promise<ImportRead> => {
  const files: BridgeImportFile[] = [];
  const skipped = createSkipList();
  const usedNames = new Set<string>();
  const directoryByName = new Map<string, string>();
  let totalBytes = 0;
  for (const path of paths) {
    const name = basename(path);
    const info = await lstat(path);
    if (!info.isFile()) {
      skipped.add(name, "Not a file");
      continue;
    }
    if (!IMPORT_SOURCES[source].noteExtensions.has(extname(name).toLowerCase())) {
      skipped.add(name, "Not a note file");
      continue;
    }
    if (info.size > EXPORT_FILE_LIMITS.fileBytes) {
      skipped.add(name, `Larger than ${sizeLabel(EXPORT_FILE_LIMITS.fileBytes)}`);
      continue;
    }
    totalBytes += info.size;
    if (totalBytes > EXPORT_FILE_LIMITS.totalBytes)
      throw tooLarge("Those files are too large to import at once. Pick fewer files.");
    // Two picked files may share a name in different folders.
    let unique = name;
    for (let copy = 2; usedNames.has(unique.toLowerCase()); copy += 1)
      unique = `${basename(name, extname(name))} (${copy})${extname(name)}`;
    usedNames.add(unique.toLowerCase());
    directoryByName.set(unique, dirname(path));
    files.push({ path: unique, text: await readFile(path, "utf8") });
  }
  return {
    name: paths.length === 1 ? basename(paths[0]!) : `${paths.length} files`,
    files,
    skipped: skipped.list(),
    images: createPickedFileImageSource(directoryByName),
  };
};

/**
 * Notion splits large exports into part zips inside the download; one level
 * is opened. Each part counts against the archive's size limit before it is
 * expanded, so nested parts can't add up to more than one archive may hold.
 */
const expandNestedZips = (entries: ZipEntry[], outerBytes: number) => {
  let expandedBytes = outerBytes;
  return entries.flatMap((entry) => {
    if (extname(entry.path).toLowerCase() !== ".zip") return [entry];
    expandedBytes += entry.size;
    if (expandedBytes > ARCHIVE_BYTES_LIMIT)
      throw tooLarge("That archive is too large to import. Unzip it and import its pages instead.");
    return listZipEntries(entry.read());
  });
};

/** Reads note files from a zip export; images stay compressed until a note asks for them. */
const readImportArchive = async (path: string, source: BridgeImportSource): Promise<ImportRead> => {
  const info = await lstat(path);
  if (!info.isFile() || extname(path).toLowerCase() !== ".zip")
    throw new StoreError("Pick the .zip file the export was saved as.", "VALIDATION_ERROR", 400);
  if (info.size > ARCHIVE_BYTES_LIMIT)
    throw tooLarge("That archive is too large to import. Unzip it and import its pages instead.");
  const entries = expandNestedZips(listZipEntries(await readFile(path)), info.size);
  entries.sort((left, right) => left.path.localeCompare(right.path));

  const files: BridgeImportFile[] = [];
  const skipped = createSkipList();
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  const index = createImageIndex();
  let totalBytes = 0;
  for (const entry of entries) {
    // Hidden files and the folders macOS adds to zips hold no notes.
    if (entry.path.split("/").some((part) => part.startsWith(".") || part === "__MACOSX")) continue;
    if (isImageFilePath(entry.path)) {
      addImage(index, entry.path);
      continue;
    }
    if (!IMPORT_SOURCES[source].noteExtensions.has(extname(entry.path).toLowerCase())) {
      skipped.add(entry.path, "Not a note file");
      continue;
    }
    if (entry.size > IMPORT_LIMITS.fileBytes) {
      skipped.add(entry.path, "Larger than 5 MB");
      continue;
    }
    totalBytes += entry.size;
    if (totalBytes > IMPORT_LIMITS.totalBytes || files.length >= IMPORT_LIMITS.files)
      throw tooLarge("That export is too large to import at once.");
    files.push({ path: entry.path, text: entry.read().toString("utf8") });
  }
  return {
    name: basename(path),
    files,
    skipped: skipped.list(),
    images: {
      locate: async (request) => locateIndexedImage(index, request),
      read: async (imagePath) => {
        const entry = byPath.get(imagePath);
        if (!entry) return IMAGE_UNREADABLE;
        if (entry.size > IMPORT_LIMITS.imageBytes) return IMAGE_TOO_LARGE;
        try {
          return new Uint8Array(entry.read());
        } catch {
          return IMAGE_UNREADABLE;
        }
      },
    },
  };
};

/** Reads what was picked for `source`: a folder, files, or one archive, as the source expects. */
export const readImport = (source: BridgeImportSource, paths: readonly string[]) => {
  const kind = IMPORT_SOURCES[source].pick;
  if (kind === "files") return readImportFiles(paths, source);
  if (paths.length !== 1)
    throw new StoreError("This import expects one folder or archive.", "VALIDATION_ERROR", 400);
  return kind === "folder"
    ? readImportFolder(paths[0]!, source)
    : readImportArchive(paths[0]!, source);
};
