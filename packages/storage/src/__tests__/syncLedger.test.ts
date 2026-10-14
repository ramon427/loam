import { describe, expect, it } from "vitest";

import { createMemoryStorageAdapter } from "../adapters/memoryAdapter";
import { syncKey } from "../sync/syncDocs";
import { SyncLedger } from "../sync/syncLedger";
import { noteId } from "../testing/storeFixtures";

const NOW = Date.UTC(2026, 9, 10, 12);

describe("SyncLedger", () => {
  it("refuses to answer for records it hasn't loaded instead of taking them for missing", async () => {
    const adapter = createMemoryStorageAdapter();
    const key = syncKey("note", noteId(1));
    const writes = await (await SyncLedger.load(adapter, () => NOW)).recordLocal([key]);
    await adapter.commit(writes);

    const ledger = await SyncLedger.load(adapter, () => NOW);
    expect(() => ledger.heldClock(key)).toThrow(/isn't loaded/);
    expect(() => ledger.unpublished()).toThrow(/aren't loaded/);
    expect(() => ledger.keys()).toThrow(/aren't loaded/);

    // A save reads just the records it touches.
    const record = await ledger.read(key);
    expect(record?.dirty).toBe(true);
    expect(ledger.heldClock(key)).toBe(record!.clock);
    expect(() => ledger.heldClock(syncKey("note", noteId(2)))).toThrow(/isn't loaded/);

    // Syncing loads them all.
    await ledger.loadAll();
    expect(ledger.heldClock(syncKey("note", noteId(2)))).toBe("");
    expect(ledger.unpublished().map((entry) => entry.key)).toEqual([key]);
  });
});
