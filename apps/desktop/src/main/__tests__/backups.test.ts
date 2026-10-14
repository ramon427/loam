import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import type { BridgeBackup, BridgeBackupKind } from "@loam/shared/bridge/loamBridge";
import type { NotesStore } from "@loam/storage/NotesStore";
import { createSqliteStorageAdapter } from "@loam/storage/adapters/sqliteAdapter";
import { createNote, createTestStore, noteId } from "@loam/storage/testing/storeFixtures";
import { createTempDirectories } from "@loam/storage/testing/tempDirectories";

import { BACKUP_FORMAT, selectBackupsToKeep } from "../backups/backupFiles";
import { createBackupManager } from "../backups/backups";

const IMAGE = "11111111-1111-4111-8111-111111111111.png";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const tempDirectory = createTempDirectories("loam-backups-");

const setup = async (storeOrPromise: NotesStore | Promise<NotesStore> = createTestStore()) => {
  const store = await storeOrPromise;
  await createNote(store, noteId(1), { title: "Kept" });
  await createNote(store, noteId(2), { title: "Also kept" });
  const mediaDirectory = tempDirectory();
  writeFileSync(join(mediaDirectory, IMAGE), "png");
  writeFileSync(join(mediaDirectory, "notes.sqlite"), "not media");
  let clock = Date.UTC(2026, 9, 10, 12);
  const directory = join(tempDirectory(), "backups");
  const restores: number[] = [];
  const backups = createBackupManager({
    store,
    directory,
    mediaDirectory,
    appVersion: "0.1.0",
    onRestored: () => restores.push(clock),
    now: () => clock,
  });
  return {
    store,
    backups,
    directory,
    mediaDirectory,
    restores,
    advance: (ms: number) => (clock += ms),
  };
};

const titles = async (store: Awaited<ReturnType<typeof createTestStore>>) =>
  (await store.getLibrary()).notes.map((note) => note.title).sort();

/** Every record's value by id, without the versions a restore rewrites. */
const contents = async (store: Awaited<ReturnType<typeof createTestStore>>) =>
  Object.fromEntries(
    Object.entries(await store.readAllRecords()).map(([collection, records]) => [
      collection,
      records
        .map(({ id, value }) => ({ id, value }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    ]),
  );

describe("backups", () => {
  it("writes a backup of every record and mirrors only media files", async () => {
    const { backups, directory } = await setup();
    const info = await backups.create("manual");

    expect(info).toMatchObject({ kind: "manual", createdAt: Date.UTC(2026, 9, 10, 12) });
    expect(info.id).toBe("loam-backup-20261010T120000000Z-manual.json.gz");
    expect(await backups.list()).toEqual([info]);
    expect(readdirSync(join(directory, "media"))).toEqual([IMAGE]);
  });

  it("restores a backup exactly, after backing up what it replaces", async () => {
    const { store, backups, advance, restores } = await setup();
    const before = await contents(store);
    const backup = await backups.create("manual");

    advance(HOUR);
    await createNote(store, noteId(3), { title: "Added later" });
    await store.deleteNote(noteId(1));
    const changed = await contents(store);

    advance(HOUR);
    expect(restores).toEqual([]);
    await backups.restore({ id: backup.id });
    expect(await contents(store)).toEqual(before);
    expect(await titles(store)).toEqual(["Also kept", "Kept"]);
    // The app restarts on a restored library.
    expect(restores).toHaveLength(1);

    // The safety backup taken first undoes the restore.
    const safety = (await backups.list()).find((entry) => entry.kind === "before-restore")!;
    advance(HOUR);
    await backups.restore({ id: safety.id });
    expect(await contents(store)).toEqual(changed);
  });

  it("restores on SQLite in one transaction", async () => {
    const { store, backups } = await setup(
      createTestStore(createSqliteStorageAdapter(join(tempDirectory(), "notes.sqlite"))),
    );
    const before = await contents(store);
    const backup = await backups.create("manual");
    await createNote(store, noteId(5), { title: "Later" });
    await backups.restore({ id: backup.id });
    expect(await contents(store)).toEqual(before);
    // The store keeps saving normally afterwards.
    await createNote(store, noteId(6), { title: "After restore" });
    expect(await titles(store)).toEqual(["After restore", "Also kept", "Kept"]);
    await store.close();
  });

  it("brings back images from the backup's media folder", async () => {
    const { backups, mediaDirectory } = await setup();
    const backup = await backups.create("manual");
    rmSync(join(mediaDirectory, IMAGE));
    await backups.restore({ id: backup.id });
    expect(readdirSync(mediaDirectory).sort()).toEqual([IMAGE, "notes.sqlite"]);
  });

  it("restores a backup file from elsewhere, with the media folder beside it", async () => {
    const source = await setup();
    const backup = await source.backups.create("manual");
    const target = await setup();
    await createNote(target.store, noteId(9), { title: "Only on the other machine" });
    rmSync(join(target.mediaDirectory, IMAGE));

    await target.backups.restore({ path: join(source.directory, backup.id) });
    expect(await titles(target.store)).toEqual(["Also kept", "Kept"]);
    expect(readdirSync(target.mediaDirectory)).toContain(IMAGE);
  });

  it("takes the daily backup only when the last one is a day old", async () => {
    const { backups, advance } = await setup();
    expect(await backups.backUpIfDue()).toMatchObject({ kind: "auto" });
    advance(23 * HOUR);
    expect(await backups.backUpIfDue()).toBeNull();
    // Safety backups don't count as the daily one.
    await backups.create("before-import");
    advance(2 * HOUR);
    expect(await backups.backUpIfDue()).toMatchObject({ kind: "auto" });
  });

  it("refuses files that are not backups, are damaged or come from a newer version", async () => {
    const { store, backups } = await setup();
    const before = await contents(store);
    const folder = tempDirectory();
    const write = (name: string, body: Buffer) => {
      writeFileSync(join(folder, name), body);
      return { path: join(folder, name) };
    };
    const file = (fields: Record<string, unknown>) =>
      gzipSync(
        JSON.stringify({
          format: BACKUP_FORMAT,
          version: 1,
          createdAt: 0,
          collections: {},
          ...fields,
        }),
      );

    await expect(backups.restore(write("a", Buffer.from("plain text")))).rejects.toMatchObject({
      code: "BACKUP_INVALID",
    });
    await expect(backups.restore(write("b", file({ format: "other" })))).rejects.toThrow(
      /not an Loam backup/,
    );
    await expect(backups.restore(write("c", file({ version: 3 })))).rejects.toThrow(
      /newer version/,
    );
    await expect(
      backups.restore(write("d", file({ collections: { secrets: [] } }))),
    ).rejects.toThrow(/unknown data/);
    await expect(
      backups.restore(write("e", file({ collections: { notes: [{ value: 1 }] } }))),
    ).rejects.toThrow(/damaged/);
    await expect(backups.restore({ id: "../notes.sqlite" })).rejects.toThrow(/Unknown backup/);
    expect(await contents(store)).toEqual(before);
    expect(await backups.list()).toEqual([]);
  });
});

describe("selectBackupsToKeep", () => {
  const backup = (createdAt: number, kind: BridgeBackupKind = "auto"): BridgeBackup => ({
    id: `${kind}-${createdAt}`,
    createdAt,
    kind,
    sizeBytes: 1,
  });
  const start = new Date(2026, 9, 31, 9).getTime();

  it("keeps the newest of each of the last 7 days, then 4 weekly, then 5 safety", () => {
    const daily = Array.from({ length: 60 }, (_, day) => backup(start - day * DAY));
    const sameDay = backup(start - 2 * HOUR, "manual");
    const safety = Array.from({ length: 8 }, (_, index) =>
      backup(start - index * HOUR, "before-import"),
    );
    const keep = selectBackupsToKeep([...daily, sameDay, ...safety]);

    const keptScheduled = [...daily, sameDay].filter((entry) => keep.has(entry.id));
    expect(keptScheduled).toHaveLength(11);
    // Of two backups on one day, the newer one stays.
    expect(keep.has(daily[0]!.id)).toBe(true);
    expect(keep.has(sameDay.id)).toBe(false);
    // The last seven days are all kept, and the oldest kept is about five weeks back.
    expect(daily.slice(0, 7).every((entry) => keep.has(entry.id))).toBe(true);
    const oldest = Math.min(...keptScheduled.map((entry) => entry.createdAt));
    expect((start - oldest) / DAY).toBeGreaterThan(28);
    expect((start - oldest) / DAY).toBeLessThan(42);
    expect(safety.filter((entry) => keep.has(entry.id))).toEqual(safety.slice(0, 5));
  });

  it("never drops backups when there are only a few", () => {
    const few = [backup(start), backup(start - 3 * DAY), backup(start - 20 * DAY)];
    expect(selectBackupsToKeep(few)).toEqual(new Set(few.map((entry) => entry.id)));
  });
});

describe("backups folder", () => {
  it("ignores unrelated files and cleans up interrupted writes", async () => {
    const { backups, directory } = await setup();
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "readme.txt"), "mine");
    writeFileSync(join(directory, "loam-backup-20261001T000000000Z-auto.json.gz.partial"), "half");
    await backups.create("manual");
    expect(readdirSync(directory).sort()).toEqual([
      "loam-backup-20261010T120000000Z-manual.json.gz",
      "media",
      "readme.txt",
    ]);
  });
});
