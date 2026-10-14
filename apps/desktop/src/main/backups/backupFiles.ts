import { createWriteStream } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { once } from "node:events";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { createGzip, gunzip } from "node:zlib";

import {
  BACKUP_KINDS,
  type BridgeBackup,
  type BridgeBackupKind,
} from "@loam/shared/bridge/loamBridge";
import { BACKUP_COLLECTIONS, type BackupRecord } from "@loam/storage/snapshots";
import { StoreError } from "@loam/storage/storeError";
import { type StorageCollection, type StorageSnapshotRecord } from "@loam/storage/adapter";
import { recordContext } from "@loam/storage/encryption/encryptedAdapter";
import { readKeyLocks, type KeyLocks } from "@loam/storage/encryption/keyLocks";
import { sealValue, type DataKey } from "@loam/storage/encryption/seal";

/*
 * A backup file: its name (when it was made, and why), which backups to
 * keep, and its contents, a gzipped JSON copy of every store record.
 */

const gunzipAsync = promisify(gunzip);

export const BACKUP_FORMAT = "loam-backup";
/** 2: records are sealed, and the header holds the key's locks. */
const BACKUP_VERSION = { plain: 1, encrypted: 2 } as const;
const BACKUP_MAX_BYTES = 2 * 1024 * 1024 * 1024;

export const SAFETY_KINDS: ReadonlySet<BridgeBackupKind> = new Set(
  BACKUP_KINDS.filter((kind) => kind.startsWith("before-")),
);

const BACKUP_RETENTION = { daily: 7, weekly: 4, safety: 5 };

const FILE_PATTERN = new RegExp(
  `^loam-backup-(\\d{4})(\\d{2})(\\d{2})T(\\d{2})(\\d{2})(\\d{2})(\\d{3})Z-(${BACKUP_KINDS.join("|")})\\.json\\.gz$`,
);

export type BackupFile = {
  format: typeof BACKUP_FORMAT;
  version: (typeof BACKUP_VERSION)[keyof typeof BACKUP_VERSION];
  createdAt: number;
  appVersion: string;
  /** In an encrypted backup: the key its records are sealed with, locked. */
  encryption?: KeyLocks;
  collections: Partial<Record<StorageCollection, BackupRecord[]>>;
};

/** The key a library seals with, and its locks, while encryption is on. */
export type BackupEncryption = { key: DataKey; locks: KeyLocks } | null;

export const invalidBackup = (message: string) => new StoreError(message, "BACKUP_INVALID", 400);

export const fileNameFor = (createdAt: number, kind: BridgeBackupKind) =>
  `loam-backup-${new Date(createdAt).toISOString().replace(/[-:.]/g, "")}-${kind}.json.gz`;

export const parseFileName = (name: string): Omit<BridgeBackup, "sizeBytes"> | null => {
  const match = FILE_PATTERN.exec(name);
  if (!match) return null;
  const [, year, month, day, hours, minutes, seconds, millis, kind] = match;
  return {
    id: name,
    createdAt: Date.UTC(+year!, +month! - 1, +day!, +hours!, +minutes!, +seconds!, +millis!),
    kind: kind as BridgeBackupKind,
  };
};

const localDayKey = (time: number) => new Date(time).toDateString();

/** Monday-based week, in local time, as the date of its Monday. */
const localWeekKey = (time: number) => {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.toDateString();
};

/**
 * Which backups to keep, newest first: the newest backup of each of the last
 * seven days that have one, then the newest of each of the four weeks before
 * those, and the last five safety backups. Everything else can go.
 */
export const selectBackupsToKeep = (backups: readonly BridgeBackup[]) => {
  const keep = new Set<string>();
  const sorted = [...backups].sort((left, right) => right.createdAt - left.createdAt);
  const scheduled = sorted.filter((backup) => !SAFETY_KINDS.has(backup.kind));
  const days = new Set<string>();
  const coveredWeeks = new Set<string>();
  for (const backup of scheduled) {
    const day = localDayKey(backup.createdAt);
    if (days.has(day) || days.size >= BACKUP_RETENTION.daily) continue;
    days.add(day);
    keep.add(backup.id);
    coveredWeeks.add(localWeekKey(backup.createdAt));
  }
  const weeks = new Set<string>();
  for (const backup of scheduled) {
    if (keep.has(backup.id) || days.has(localDayKey(backup.createdAt))) continue;
    const week = localWeekKey(backup.createdAt);
    if (coveredWeeks.has(week) || weeks.has(week) || weeks.size >= BACKUP_RETENTION.weekly)
      continue;
    weeks.add(week);
    keep.add(backup.id);
  }
  sorted
    .filter((backup) => SAFETY_KINDS.has(backup.kind))
    .slice(0, BACKUP_RETENTION.safety)
    .forEach((backup) => keep.add(backup.id));
  return keep;
};

/** Backups from before storage version 2 also hold records only that version read. */
const LEGACY_COLLECTIONS = new Set(["tombstones", "receipts"]);

export const readBackupFile = async (path: string): Promise<BackupFile> => {
  let parsed: unknown;
  try {
    const raw = await gunzipAsync(await readFile(path), { maxOutputLength: BACKUP_MAX_BYTES });
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    throw invalidBackup("That file is not an Loam backup, or it is damaged.");
  }
  const file = parsed as Partial<BackupFile> | null;
  if (!file || file.format !== BACKUP_FORMAT || typeof file.collections !== "object")
    throw invalidBackup("That file is not an Loam backup.");
  if (file.version !== BACKUP_VERSION.plain && file.version !== BACKUP_VERSION.encrypted)
    throw invalidBackup("That backup was made by a newer version of Loam. Update the app first.");
  if (file.version === BACKUP_VERSION.encrypted) {
    const locks = readKeyLocks(file.encryption);
    if (!locks) throw invalidBackup("That backup is damaged.");
    file.encryption = locks;
  } else delete file.encryption;
  for (const [collection, records] of Object.entries(file.collections ?? {})) {
    if (LEGACY_COLLECTIONS.has(collection)) {
      delete (file.collections as Record<string, unknown>)[collection];
      continue;
    }
    if (!(BACKUP_COLLECTIONS as readonly string[]).includes(collection))
      throw invalidBackup(`That backup has unknown data ("${collection}").`);
    if (
      !Array.isArray(records) ||
      records.some((record) => typeof (record as BackupRecord)?.id !== "string")
    )
      throw invalidBackup("That backup is damaged.");
  }
  return file as BackupFile;
};

const CHUNK_CHARACTERS = 256 * 1024;

/**
 * An encrypted store's snapshot holds its sealed values; a store without
 * snapshots hands over plain ones, which the backup seals itself.
 */
const SEALED_JSON_START = '{"loamSealed":';
const sealJson = (key: DataKey, { collection, id, json }: StorageSnapshotRecord) =>
  JSON.stringify(sealValue(key, JSON.parse(json), recordContext(collection, id)));

export async function* fileRecords(file: BackupFile): AsyncIterable<StorageSnapshotRecord> {
  for (const [collection, records] of Object.entries(file.collections))
    for (const record of records ?? [])
      yield {
        collection: collection as StorageCollection,
        id: record.id,
        json: JSON.stringify(record.value),
      };
}

/**
 * Writes the backup file as a stream: each record's stored JSON is spliced in
 * as is, so a large library is never parsed, held whole in memory, or
 * compressed on the main thread. The result is the same JSON a reader parses.
 */
export const writeBackupStream = async (
  path: string,
  records: AsyncIterable<StorageSnapshotRecord>,
  {
    createdAt,
    appVersion,
    encryption,
  }: { createdAt: number; appVersion: string; encryption: BackupEncryption },
) => {
  const gzip = createGzip();
  const done = pipeline(gzip, createWriteStream(path));
  let chunk = "";
  const flush = async () => {
    if (!gzip.write(chunk)) await once(gzip, "drain");
    chunk = "";
  };
  const push = async (text: string) => {
    chunk += text;
    if (chunk.length >= CHUNK_CHARACTERS) await flush();
  };
  try {
    const version = encryption ? BACKUP_VERSION.encrypted : BACKUP_VERSION.plain;
    await push(
      `{"format":${JSON.stringify(BACKUP_FORMAT)},"version":${version},` +
        `"createdAt":${createdAt},"appVersion":${JSON.stringify(appVersion)},` +
        (encryption ? `"encryption":${JSON.stringify(encryption.locks)},` : "") +
        `"collections":{`,
    );
    let collection: string | null = null;
    let first = true;
    for await (const record of records) {
      if (record.collection !== collection) {
        await push(`${collection === null ? "" : "],"}${JSON.stringify(record.collection)}:[`);
        collection = record.collection;
        first = true;
      }
      const json =
        encryption && !record.json.startsWith(SEALED_JSON_START)
          ? sealJson(encryption.key, record)
          : record.json;
      await push(`${first ? "" : ","}{"id":${JSON.stringify(record.id)},"value":${json}}`);
      first = false;
    }
    await push(collection === null ? "}}" : "]}}");
    await flush();
    gzip.end();
    await done;
  } catch (error) {
    gzip.destroy(error as Error);
    await done.catch(() => undefined);
    await rm(path, { force: true });
    throw error;
  }
};
