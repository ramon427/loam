import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
});

import { SyncFolder, syncWithFolder } from "@loam/storage/sync/syncFolder";
import { parseSyncCode, serverStorage } from "@loam/storage/sync/syncServer";
import {
  createClock,
  createNote,
  createTestStore,
  noteId,
} from "@loam/storage/testing/storeFixtures";

import { createMemoryBucket } from "../testing/memoryBucket";
import { handleRequest } from "../worker";

const KEY = "k".repeat(43);
const ORIGIN = "https://loam-sync.example.workers.dev";

/** A sync server in memory, and a fetch that reaches it. */
const startServer = () => {
  const { bucket, files } = createMemoryBucket();
  const requests: Request[] = [];
  const fetchServer: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request.clone());
    return handleRequest(request, { BUCKET: bucket, SYNC_KEY: KEY });
  };
  return { files, requests, fetchServer };
};

const call = (fetchServer: typeof fetch, path: string, init: RequestInit = {}, key = KEY) =>
  fetchServer(`${ORIGIN}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${key}`, ...init.headers },
  });

describe("sync server", () => {
  it("stores, lists and removes files for the computers that hold its key", async () => {
    const { fetchServer } = startServer();
    expect((await call(fetchServer, "/v1/files/library.json", {}, "w".repeat(43))).status).toBe(
      401,
    );
    expect((await fetchServer(`${ORIGIN}/v1/list?prefix=`)).status).toBe(401);

    expect(
      (await call(fetchServer, "/v1/files/devices/a/note-1.json", { method: "PUT", body: "one" }))
        .status,
    ).toBe(204);
    const file = await call(fetchServer, "/v1/files/devices/a/note-1.json");
    expect(await file.text()).toBe("one");

    const listed = await call(fetchServer, "/v1/list?prefix=devices/");
    expect(await listed.json()).toEqual({ paths: ["devices/a/note-1.json"] });

    await call(fetchServer, "/v1/files/devices/a/note-1.json", { method: "DELETE" });
    expect((await call(fetchServer, "/v1/files/devices/a/note-1.json")).status).toBe(404);
  });

  it("answers an unchanged listing with 304 until a file is written", async () => {
    const { fetchServer } = startServer();
    await call(fetchServer, "/v1/files/media/a.png", { method: "PUT", body: "png" });
    const first = await call(fetchServer, "/v1/list?prefix=media/");
    const etag = first.headers.get("etag")!;
    const again = await call(fetchServer, "/v1/list?prefix=media/", {
      headers: { "if-none-match": etag },
    });
    expect(again.status).toBe(304);

    await call(fetchServer, "/v1/files/media/b.png", { method: "PUT", body: "png" });
    const changed = await call(fetchServer, "/v1/list?prefix=media/", {
      headers: { "if-none-match": etag },
    });
    expect(await changed.json()).toEqual({ paths: ["media/a.png", "media/b.png"] });
  });

  it("stores a file even while R2 refuses the stamp, and lists it within minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { bucket } = createMemoryBucket();
    const put = bucket.put.bind(bucket);
    let busy = false;
    bucket.put = async (key, value) => {
      // R2 refuses frequent writes to one object.
      if (busy && key === ".stamp")
        throw new Error("put: Reduce your concurrent request rate for the same object. (10058)");
      return put(key, value);
    };
    const waits: number[] = [];
    const serve = (path: string, init: RequestInit = {}) =>
      handleRequest(
        new Request(`${ORIGIN}${path}`, {
          ...init,
          headers: { authorization: `Bearer ${KEY}`, ...init.headers },
        }),
        { BUCKET: bucket, SYNC_KEY: KEY },
        undefined,
        async (ms) => void waits.push(ms),
      );
    const etag = (await serve("/v1/list?prefix=")).headers.get("etag")!;

    busy = true;
    expect((await serve("/v1/files/a", { method: "PUT", body: "x" })).status).toBe(204);
    expect(waits).toEqual([1100, 2200]);
    const listing = { headers: { "if-none-match": etag } };
    expect((await serve("/v1/list?prefix=", listing)).status).toBe(304);
    vi.setSystemTime(Date.now() + 5 * 60_000);
    expect(await (await serve("/v1/list?prefix=", listing)).json()).toEqual({ paths: ["a"] });
  });

  it("refuses paths outside the sync files and hides its stamp", async () => {
    const { fetchServer } = startServer();
    for (const path of ["/v1/files/.stamp", "/v1/files/a//b", "/v1/files/a%2F..%2Fb"])
      expect((await call(fetchServer, path, { method: "PUT", body: "x" })).status).toBe(400);
    await call(fetchServer, "/v1/files/a", { method: "PUT", body: "x" });
    expect(await (await call(fetchServer, "/v1/list?prefix=")).json()).toEqual({ paths: ["a"] });
  });

  it("lists more files than fit on one page", async () => {
    const { fetchServer } = startServer();
    const storage = serverStorage(parseSyncCode(`${ORIGIN}/#${KEY}`)!, fetchServer);
    const paths = Array.from(
      { length: 1001 },
      (_, index) => `media/${String(index).padStart(4, "0")}`,
    );
    for (const path of paths) await storage.write(path, "x");
    expect(await storage.list("media/")).toEqual(paths);
  });

  it("keeps two computers' notes in step", async () => {
    const { fetchServer, requests, files } = startServer();
    const server = parseSyncCode(`${ORIGIN}/#${KEY}`)!;
    const computer = async () => {
      const store = await createTestStore(undefined, createClock());
      const folder = new SyncFolder(
        serverStorage(server, fetchServer),
        await store.readSyncDevice(),
      );
      return { store, sync: () => syncWithFolder(store, folder) };
    };
    const one = await computer();
    const two = await computer();
    await createNote(one.store, noteId(1), { title: "Written on one" });
    await one.sync();
    await two.sync();
    expect((await two.store.getLibrary()).notes.map((note) => note.title)).toEqual([
      "Written on one",
    ]);

    // Nothing changed: looking again lists nothing anew.
    requests.length = 0;
    await two.sync();
    const listings = requests.filter((request) => new URL(request.url).pathname === "/v1/list");
    expect(listings.length).toBeGreaterThan(0);
    expect(listings.every((request) => request.headers.has("if-none-match"))).toBe(true);
    expect([...files.keys()].some((key) => key.startsWith("devices/"))).toBe(true);
  });
});

describe("sync codes", () => {
  it("reads the server and key, and refuses anything else", () => {
    expect(parseSyncCode(` ${ORIGIN}/#${KEY} `)).toEqual({ url: ORIGIN, key: KEY });
    expect(parseSyncCode(`${ORIGIN}/sync/#${KEY}`)).toEqual({ url: `${ORIGIN}/sync`, key: KEY });
    expect(parseSyncCode(`http://127.0.0.1:8787/#${KEY}`)).toEqual({
      url: "http://127.0.0.1:8787",
      key: KEY,
    });
    for (const code of [
      `http://example.com/#${KEY}`,
      `${ORIGIN}/#short`,
      `${ORIGIN}/`,
      `https://user:pass@example.com/#${KEY}`,
      `${ORIGIN}/?x=1#${KEY}`,
      "not a code",
    ])
      expect(parseSyncCode(code)).toBeNull();
  });
});
