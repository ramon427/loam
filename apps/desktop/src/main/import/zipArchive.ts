import { inflateRawSync } from "node:zlib";

import { StoreError } from "@loam/storage/storeError";

/**
 * A small reader for the zip files exports come in (Notion nests a zip per
 * part inside the download). Entries are listed up front and decompressed
 * only when read, each capped at its declared size so a crafted archive
 * can't expand without bound. Zip64 and encrypted entries are not supported.
 */

export type ZipEntry = { path: string; size: number; read: () => Buffer };

const ZIP_LIMITS = { entries: 50_000, totalBytes: 2 * 1024 * 1024 * 1024 };

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ENCRYPTED_FLAG = 0x1;
const STORED = 0;
const DEFLATED = 8;

const invalidZip = (message: string) => new StoreError(message, "IMPORT_INVALID_ARCHIVE", 400);

const findEndOfCentralDirectory = (buffer: Buffer) => {
  // The record is 22 bytes plus a comment of at most 65,535 bytes.
  const earliest = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= earliest; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  throw invalidZip("That file is not a zip archive.");
};

/** A safe relative path, or null for names that are absolute or climb out. */
const readEntryPath = (raw: string) => {
  const parts: string[] = [];
  for (const part of raw.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") return null;
    parts.push(part);
  }
  if (/^[a-zA-Z]:/.test(parts[0] ?? "")) return null;
  return parts.length ? parts.join("/") : null;
};

export const listZipEntries = (buffer: Buffer): ZipEntry[] => {
  if (buffer.length < 22) throw invalidZip("That file is not a zip archive.");
  const end = findEndOfCentralDirectory(buffer);
  const count = buffer.readUInt16LE(end + 10);
  const directoryOffset = buffer.readUInt32LE(end + 16);
  if (count === 0xffff || directoryOffset === 0xffffffff)
    throw invalidZip("Zip archives over 4 GB are not supported. Unzip it and import the folder.");
  if (count > ZIP_LIMITS.entries) throw invalidZip("That archive has too many files to import.");

  const entries: ZipEntry[] = [];
  let totalBytes = 0;
  let offset = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE)
      throw invalidZip("That zip archive is damaged.");
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const rawName = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;

    const path = readEntryPath(rawName);
    const isDirectory = rawName.endsWith("/");
    if (!path || isDirectory || flags & ENCRYPTED_FLAG) continue;
    if (method !== STORED && method !== DEFLATED) continue;
    totalBytes += size;
    if (totalBytes > ZIP_LIMITS.totalBytes)
      throw invalidZip("That archive is too large to import.");

    entries.push({
      path,
      size,
      read: () => {
        if (
          localOffset + 30 > buffer.length ||
          buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE
        )
          throw invalidZip("That zip archive is damaged.");
        const start =
          localOffset +
          30 +
          buffer.readUInt16LE(localOffset + 26) +
          buffer.readUInt16LE(localOffset + 28);
        const data = buffer.subarray(start, start + compressedSize);
        if (size === 0) return Buffer.alloc(0);
        let bytes: Buffer;
        try {
          bytes = method === STORED ? data : inflateRawSync(data, { maxOutputLength: size });
        } catch {
          // Includes data that inflates past its declared size.
          throw invalidZip("That zip archive is damaged.");
        }
        if (bytes.length !== size) throw invalidZip("That zip archive is damaged.");
        return Buffer.from(bytes);
      },
    });
  }
  return entries;
};
