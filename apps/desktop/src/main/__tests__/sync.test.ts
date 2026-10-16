import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BridgeSyncStatus } from "@loam/shared/bridge/loamBridge";
import type { NotesStore, StoreChange } from "@loam/storage/NotesStore";
import { createNote, createTestStore, noteId } from "@loam/storage/testing/storeFixtures";
import { createTempDirectories } from "@loam/storage/testing/tempDirectories";

import { createSyncService, type SyncService, type SyncTiming } from "../sync";

const TIMING: SyncTiming = {
  afterChangeMs: 20,
  maxWaitMs: 80,
  pollMs: 60,
  retryMs: 30,
  maxRetryMs: 60,
};
const IMAGE = "11111111-2222-4333-8444-555555555555.png";

const tempDirectory = createTempDirectories("loam-sync-service-");
let root: string;
let shared: string;
const services: SyncService[] = [];

beforeEach(async () => {
  root = tempDirectory();
  shared = join(root, "Dropbox");
  await mkdir(shared);
});

afterEach(async () => {
  for (const service of services.splice(0)) await service.turnOff();
});

const startDevice = async (name: string) => {
  const dataDirectory = join(root, name);
  const mediaDirectory = join(dataDirectory, "media");
  await mkdir(mediaDirectory, { recursive: true });
  const store = await createTestStore();
  const statuses: BridgeSyncStatus[] = [];
  const changes: StoreChange[] = [];
  store.onChange((change) => changes.push(change));
  /** Starts a sync service for this computer, as each app launch does. */
  const start = async () => {
    const service = await createSyncService({
      store,
      dataDirectory,
      mediaDirectory,
      onStatus: (status) => statuses.push(status),
      timing: TIMING,
    });
    services.push(service);
    return service;
  };
  const service = await start();
  return { store, service, restart: start, statuses, changes, dataDirectory, mediaDirectory };
};

const titles = async (store: NotesStore) =>
  (await store.getLibrary()).notes.map((note) => note.title).sort();

describe("sync service", () => {
  it("is off until a folder is chosen", async () => {
    const device = await startDevice("one");
    expect(await device.service.status()).toMatchObject({ folder: null, state: "off" });
  });

  it("syncs notes and images between two computers through the folder", async () => {
    const one = await startDevice("one");
    const two = await startDevice("two");
    await createNote(one.store, noteId(1), { title: "Written on one" });
    await writeFile(join(one.mediaDirectory, IMAGE), "png bytes");

    expect(await one.service.useFolder(shared)).toMatchObject({
      folder: shared,
      state: "synced",
      unpublished: 0,
    });
    await two.service.useFolder(shared);

    expect(await titles(two.store)).toEqual(["Written on one"]);
    expect(await readdir(two.mediaDirectory)).toEqual([IMAGE]);
    expect(two.changes).toEqual([
      expect.objectContaining({ changedNoteIds: [noteId(1)], conflicts: [] }),
    ]);
  });

  it("publishes changes shortly after they are made and picks up others' on its own", async () => {
    const one = await startDevice("one");
    const two = await startDevice("two");
    await one.service.useFolder(shared);
    await two.service.useFolder(shared);

    await createNote(one.store, noteId(2), { title: "Made later" });
    expect((await one.service.status()).unpublished).toBe(2);
    await vi.waitFor(async () => expect(await titles(two.store)).toEqual(["Made later"]), {
      timeout: 2000,
    });
  });

  it("reports an unreachable folder, keeps changes and retries until it is back", async () => {
    const one = await startDevice("one");
    await one.service.useFolder(shared);
    // The cloud drive's folder disappears: its place is taken by a file.
    await rm(shared, { recursive: true });
    await writeFile(shared, "");
    await createNote(one.store, noteId(3), { title: "Waits" });
    await vi.waitFor(async () => expect((await one.service.status()).state).toBe("error"), {
      timeout: 2000,
    });
    expect(await one.service.status()).toMatchObject({
      error: expect.stringContaining("Can't reach the sync folder"),
      unpublished: 2,
    });

    await rm(shared);
    await mkdir(shared);
    await vi.waitFor(
      async () => expect(await one.service.status()).toMatchObject({ state: "synced" }),
      {
        timeout: 2000,
      },
    );
    expect((await one.service.status()).unpublished).toBe(0);
  });

  it("remembers the folder across restarts and forgets it when turned off", async () => {
    const one = await startDevice("one");
    await one.service.useFolder(shared);
    const again = await one.restart();
    expect((await again.status()).folder).toBe(shared);

    expect(await again.turnOff()).toMatchObject({ folder: null, state: "off" });
    expect((await (await one.restart()).status()).folder).toBeNull();
  });

  it("won't sync into its own data folder", async () => {
    const one = await startDevice("one");
    await expect(one.service.useFolder(join(one.dataDirectory, "sync"))).rejects.toThrow(
      "outside Loam' own data folder",
    );
  });

  it("publishes waiting changes before the app quits", async () => {
    const one = await startDevice("one");
    await one.service.useFolder(shared);
    await createNote(one.store, noteId(4), { title: "Last edit" });
    await one.service.flush(2000);
    expect((await one.service.status()).unpublished).toBe(0);
  });
});
