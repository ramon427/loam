import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BridgeSyncStatus } from "@loam/shared/bridge/loamBridge";
import type { NotesStore, StoreChange } from "@loam/storage/NotesStore";
import { createNote, createTestStore, noteId } from "@loam/storage/testing/storeFixtures";
import { createTempDirectories } from "@loam/storage/testing/tempDirectories";

import { createMemoryBucket } from "../../../../sync-server/src/testing/memoryBucket";
import { handleRequest } from "../../../../sync-server/src/worker";
import { createSyncService, type SyncService, type SyncTiming } from "../sync";
import { fakeSecrets } from "./fakeSecrets";

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
  server = startServer();
});

afterEach(async () => {
  for (const service of services.splice(0)) await service.turnOff();
});

const SERVER_KEY = "loam-sync-key-".repeat(4);
const SYNC_CODE = `https://loam-sync.example.workers.dev/#${SERVER_KEY}`;

/** A sync server in memory; `down` makes it unreachable. */
const startServer = () => {
  const { bucket } = createMemoryBucket();
  const server = {
    down: false,
    fetch: (async (input, init) => {
      if (server.down) throw new TypeError("fetch failed");
      return handleRequest(new Request(input, init), { BUCKET: bucket, SYNC_KEY: SERVER_KEY });
    }) as typeof fetch,
  };
  return server;
};
let server: ReturnType<typeof startServer>;

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
      secrets: fakeSecrets,
      fetchImpl: server.fetch,
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

  it("syncs notes and images between two computers through a sync server", async () => {
    const one = await startDevice("one");
    const two = await startDevice("two");
    await createNote(one.store, noteId(1), { title: "Written on one" });
    await writeFile(join(one.mediaDirectory, IMAGE), "png bytes");

    expect(await one.service.useServer(SYNC_CODE)).toMatchObject({
      folder: null,
      server: "loam-sync.example.workers.dev",
      state: "synced",
      unpublished: 0,
    });
    await two.service.useServer(SYNC_CODE);

    expect(await titles(two.store)).toEqual(["Written on one"]);
    expect(await readdir(two.mediaDirectory)).toEqual([IMAGE]);
    // The key is kept sealed, and the server is used again after a restart.
    expect(await readFile(join(one.dataDirectory, "sync.json"), "utf8")).not.toContain(SERVER_KEY);
    expect((await (await one.restart()).status()).server).toBe("loam-sync.example.workers.dev");
  });

  it("refuses a code that isn't one, or that the server doesn't accept", async () => {
    const one = await startDevice("one");
    await expect(one.service.useServer("https://example.com")).rejects.toThrow(
      "That isn't a sync code",
    );
    await expect(
      one.service.useServer(`https://loam-sync.example.workers.dev/#${"w".repeat(43)}`),
    ).rejects.toThrow("didn't accept this computer's sync code");
    expect((await one.service.status()).state).toBe("off");
  });

  it("keeps changes while the sync server can't be reached and sends them once it is back", async () => {
    const one = await startDevice("one");
    await one.service.useServer(SYNC_CODE);
    server.down = true;
    await createNote(one.store, noteId(3), { title: "Waits" });
    await vi.waitFor(async () => expect((await one.service.status()).state).toBe("error"), {
      timeout: 2000,
    });
    expect((await one.service.status()).error).toContain("Can't reach the sync server");

    server.down = false;
    await vi.waitFor(
      async () =>
        expect(await one.service.status()).toMatchObject({ state: "synced", unpublished: 0 }),
      { timeout: 2000 },
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
