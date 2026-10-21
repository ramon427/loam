import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

import {
  buildMediaUrl,
  isStoredMediaName,
  isTabDocumentName,
  readMediaFileName,
} from "@loam/shared/notes/mediaFiles";
import { readIfExists, writeFileAtomic } from "@loam/storage/files";
import { StoreError } from "@loam/storage/storeError";
import { openFile, sealedFileKeyId, sealFile, type DataKey } from "@loam/storage/encryption/seal";
import type { SyncFolder } from "@loam/storage/sync/syncFolder";
import { forEachConcurrently } from "@loam/shared/utils/concurrency";

import { MIME_TYPES } from "./rendererProtocol";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const EXTENSIONS = {
  "image/avif": ".avif",
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
} as const;

/** An image's type from its first bytes; a name or a declared type alone is not trusted. */
export const imageTypeOf = (bytes: Uint8Array): keyof typeof EXTENSIONS | null => {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(8, 12))) return "image/avif";
  return null;
};

/** Binds a sealed image to its name, so one image's file can't pass for another's. */
const mediaContext = (fileName: string) => `loam-media:${fileName}`;

/**
 * The keys images are handled with: new images are sealed with `seal` (plain
 * when null), and images sealed with any of `open` can be shown; plain images
 * only when `open` includes null. While a conversion runs, `open` holds the
 * old key and the new one.
 */
export type MediaKeys = { seal: DataKey | null; open: ReadonlyArray<DataKey | null> };

/** A plain library's keys. */
export const PLAIN_MEDIA: MediaKeys = { seal: null, open: [null] };

/** An image's bytes as shown: opened when sealed, as is when plain and plain is accepted. */
export const openMedia = (keys: MediaKeys, fileName: string, bytes: Uint8Array) =>
  openFile(keys.open, bytes, mediaContext(fileName));

/** Seals an image's plain bytes with `key`, or leaves them plain without one. */
const sealMedia = (key: DataKey | null, fileName: string, plain: Uint8Array) =>
  key ? sealFile(key, plain, mediaContext(fileName)) : plain;

/**
 * Images live as files next to the database, named by random id; sealed with
 * the library's key while encryption is on.
 */
export const createMediaStore = (directory: string, keys: () => MediaKeys = () => PLAIN_MEDIA) => {
  /**
   * An image by its file name or `loam-media://` URL, opened when sealed.
   * Only files the media folder named itself can be read.
   */
  const readImageFile = async (reference: string) => {
    const url = URL.parse(reference);
    const fileName = url?.search || url?.hash ? null : readMediaFileName(reference);
    if (!fileName) throw new StoreError("Invalid image reference.", "VALIDATION_ERROR", 400);
    try {
      return {
        fileName,
        bytes: openMedia(keys(), fileName, await readFile(join(directory, fileName))),
        mimeType: MIME_TYPES.get(extname(fileName)) ?? "application/octet-stream",
      };
    } catch {
      throw new StoreError("Image not found.", "NOT_FOUND", 404);
    }
  };

  return {
    directory,
    readImageFile,
    /**
     * Writes a copy of an image, opened, to the file `pick` asks the user for
     * (given the image's name and extension).
     */
    async saveImageCopy(
      reference: string,
      pick: (fileName: string, extension: string) => Promise<string | null>,
    ): Promise<{ status: "saved" | "canceled" }> {
      const image = await readImageFile(reference);
      const path = await pick(image.fileName, extname(image.fileName).slice(1));
      if (!path) return { status: "canceled" };
      await writeFile(path, image.bytes);
      return { status: "saved" };
    },
    /** Saves an image under a new name; its type is read from its bytes. */
    async saveImage(bytes: Uint8Array) {
      if (bytes.byteLength === 0)
        throw new StoreError("The image is empty.", "VALIDATION_ERROR", 400);
      if (bytes.byteLength > MAX_IMAGE_BYTES)
        throw new StoreError("Images must be 10MB or smaller.", "MEDIA_TOO_LARGE", 413);
      const type = imageTypeOf(bytes);
      if (!type) throw new StoreError("Unsupported image type.", "MEDIA_TYPE_UNSUPPORTED", 415);
      await mkdir(directory, { recursive: true });
      const fileName = `${randomUUID()}${EXTENSIONS[type]}`;
      await writeFile(join(directory, fileName), sealMedia(keys().seal, fileName, bytes), {
        flag: "wx",
      });
      return { path: fileName, url: buildMediaUrl(fileName) };
    },
    /** Saves a PDF or Word document for a file tab under a new name; the caller checked its bytes. */
    async saveDocument(extension: ".pdf" | ".docx", bytes: Uint8Array) {
      await mkdir(directory, { recursive: true });
      const fileName = `${randomUUID()}${extension}`;
      await writeFile(join(directory, fileName), sealMedia(keys().seal, fileName, bytes), {
        flag: "wx",
      });
      return fileName;
    },
    /** A document `saveDocument` stored, opened when sealed. */
    async readDocument(fileName: string) {
      if (!isTabDocumentName(fileName))
        throw new StoreError("Invalid file reference.", "VALIDATION_ERROR", 400);
      try {
        return openMedia(keys(), fileName, await readFile(join(directory, fileName)));
      } catch {
        throw new StoreError("This file is missing.", "NOT_FOUND", 404);
      }
    },
    async readImage(reference: string) {
      const { bytes, mimeType } = await readImageFile(reference);
      return { base64: bytes.toString("base64"), mimeType };
    },
    /** Handles `loam-media://images/<file>`; anything else is a 404. */
    async handleRequest(request: Request) {
      const fileName = readMediaFileName(request.url);
      if (!fileName) return new Response("Not found", { status: 404 });
      try {
        const body = openMedia(keys(), fileName, await readFile(join(directory, fileName)));
        return new Response(new Uint8Array(body), {
          headers: {
            "Content-Type": MIME_TYPES.get(extname(fileName)) ?? "application/octet-stream",
            "Cache-Control": "private, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
          },
        });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    },
  };
};

export type MediaStore = ReturnType<typeof createMediaStore>;

const listMedia = async (directory: string) =>
  ((await readIfExists(readdir(directory))) ?? []).filter((name) => isStoredMediaName(name));

/**
 * Copies the images `from` has and `to` lacks. Names are unique, so an image
 * is never replaced. Each lands under a temporary name first, so a folder a
 * cloud drive syncs never holds half an image under its real name.
 *
 * With `convert`, each image is stored the way `convert` says (for example
 * sealed with this library's key) instead of copied as is.
 */
export const copyMissingMedia = async (
  from: string,
  to: string,
  convert?: (name: string, bytes: Buffer) => Uint8Array,
) => {
  const names = await listMedia(from);
  if (names.length === 0) return 0;
  await mkdir(to, { recursive: true });
  const existing = new Set(await listMedia(to));
  let copied = 0;
  for (const name of names) {
    if (existing.has(name)) continue;
    const bytes = await readFile(join(from, name));
    await writeFileAtomic(join(to, name), convert ? convert(name, bytes) : bytes);
    copied += 1;
  }
  return copied;
};

/**
 * Shares the images this library has and sync lacks, and keeps the ones sync
 * has and this library lacks, stored the way `convert` says. Names are unique,
 * so an image is never replaced.
 */
export const exchangeMedia = async (
  directory: string,
  shared: SyncFolder,
  convert?: (name: string, bytes: Buffer) => Uint8Array,
) => {
  const here = await listMedia(directory);
  const there = await shared.listMedia();
  const hereNames = new Set(here);
  const thereNames = new Set(there);
  const missingThere = here.filter((name) => !thereNames.has(name));
  const missingHere = there.filter((name) => !hereNames.has(name));
  await forEachConcurrently(missingThere, 4, async (name) =>
    shared.writeMedia(name, await readFile(join(directory, name))),
  );
  if (missingHere.length > 0) await mkdir(directory, { recursive: true });
  await forEachConcurrently(missingHere, 4, async (name) => {
    const stored = await shared.readMedia(name);
    if (!stored) return;
    const bytes = Buffer.from(stored.buffer, stored.byteOffset, stored.byteLength);
    await writeFileAtomic(join(directory, name), convert ? convert(name, bytes) : bytes);
  });
};

/**
 * How to store an image that arrives from elsewhere (a backup, a sync folder)
 * in a library using `keys`: sealed with its key, or plain. Images that can't
 * be opened are kept as they are; they show as missing, as before.
 */
export const mediaConverter =
  (keys: MediaKeys) =>
  (name: string, bytes: Buffer): Uint8Array => {
    const keyId = sealedFileKeyId(bytes);
    if (keyId === (keys.seal?.id ?? null)) return bytes;
    try {
      return sealMedia(keys.seal, name, openMedia(keys, name, bytes));
    } catch {
      return bytes;
    }
  };

/**
 * Re-stores every image in `directory` the way `keys` says. Images already in
 * that form are skipped, so this can run again after it was interrupted.
 */
export const convertMediaFolder = async (directory: string, keys: MediaKeys) => {
  const convert = mediaConverter(keys);
  for (const name of await listMedia(directory)) {
    const bytes = await readFile(join(directory, name));
    const next = convert(name, bytes);
    if (next !== bytes) await writeFileAtomic(join(directory, name), next);
  }
};
