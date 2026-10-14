import { describe, expect, it } from "vitest";

import type { NoteContent } from "@loam/shared/notes/noteModel";

import { createMemoryStorageAdapter } from "../adapters/memoryAdapter";
import {
  HISTORY_CAPTURE_INTERVAL_MS,
  planHistoryCapture,
  selectVersionsToKeep,
  type HistoryEntry,
} from "../noteHistory";
import {
  bodyPatch,
  createNote,
  createTestStore,
  noteId,
  paragraph,
  text,
} from "../testing/storeFixtures";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 10, 12);

const entry = (capturedAt: number, id = `v-${capturedAt}`): HistoryEntry => ({
  id,
  savedAt: capturedAt,
  capturedAt,
  title: "Note",
  sizeBytes: 10,
  contentHash: id,
});

let counter = 0;
const createId = () => `id-${++counter}`;

describe("selectVersionsToKeep", () => {
  it("keeps the last day, then hourly for a week, then daily for a month", () => {
    const versions = [
      ...Array.from({ length: 12 }, (_, index) => entry(NOW - index * 10 * MINUTE)),
      // Two in the same hour, three days back: only the newer one stays.
      entry(NOW - 3 * DAY - 10 * MINUTE),
      entry(NOW - 3 * DAY - 20 * MINUTE),
      // Two on the same day, twenty days back.
      entry(NOW - 20 * DAY - HOUR),
      entry(NOW - 20 * DAY - 2 * HOUR),
      entry(NOW - 40 * DAY),
    ];
    const kept = selectVersionsToKeep(versions, NOW).map((version) => version.capturedAt);
    expect(kept).toEqual([
      ...Array.from({ length: 12 }, (_, index) => NOW - index * 10 * MINUTE),
      NOW - 3 * DAY - 10 * MINUTE,
      NOW - 20 * DAY - HOUR,
    ]);
  });

  it("keeps at most 100", () => {
    const versions = Array.from({ length: 140 }, (_, index) => entry(NOW - index * MINUTE));
    expect(selectVersionsToKeep(versions, NOW)).toHaveLength(100);
  });
});

describe("planHistoryCapture", () => {
  const document = (body: string): NoteContent => ({
    title: "Note",
    tabs: [{ id: "t", title: "Notes" }],
    activeTabId: "t",
    blocksByTab: { t: [body] },
  });

  it("keeps a note's first replaced content and then at most one every ten minutes", () => {
    const first = planHistoryCapture({
      index: null,
      document: document("a"),
      savedAt: NOW - DAY,
      now: NOW,
      force: false,
      createId,
    });
    expect(first?.entry).toMatchObject({ savedAt: NOW - DAY, capturedAt: NOW, title: "Note" });

    const soon = { index: first!.index, document: document("b"), savedAt: NOW, createId };
    expect(planHistoryCapture({ ...soon, now: NOW + 5 * MINUTE, force: false })).toBeNull();
    expect(planHistoryCapture({ ...soon, now: NOW + 5 * MINUTE, force: true })).not.toBeNull();
    expect(
      planHistoryCapture({ ...soon, now: NOW + HISTORY_CAPTURE_INTERVAL_MS, force: false }),
    ).not.toBeNull();
  });

  it("never keeps the same content twice in a row", () => {
    const first = planHistoryCapture({
      index: null,
      document: document("a"),
      savedAt: NOW - DAY,
      now: NOW,
      force: false,
      createId,
    })!;
    expect(
      planHistoryCapture({
        index: first.index,
        // Only the save time differs.
        document: document("a"),
        savedAt: NOW,
        now: NOW + DAY,
        force: true,
        createId,
      }),
    ).toBeNull();
  });

  // Stored versions carry this hash; a different one would keep an unchanged note again.
  it("hashes content as earlier versions did", () => {
    const capture = (content: NoteContent) =>
      planHistoryCapture({
        index: null,
        document: content,
        savedAt: 0,
        now: NOW,
        force: true,
        createId,
      });
    expect(capture(document("a"))?.entry.contentHash).toMatchInlineSnapshot(`"fnv1a:44ecd365"`);
    expect(
      capture({
        ...document("Café ☕"),
        video: { url: "https://example.com/v" } as NoteContent["video"],
      })?.entry.contentHash,
    ).toMatchInlineSnapshot(`"fnv1a:7120b9ad"`);
  });

  it("measures a version's size in UTF-8 bytes", () => {
    const content = document("Café ☕");
    const plan = planHistoryCapture({
      index: null,
      document: content,
      savedAt: 0,
      now: NOW,
      force: true,
      createId,
    });
    // "é" takes two bytes and "☕" three, one UTF-16 unit each.
    expect(plan?.entry.sizeBytes).toBe(JSON.stringify(content).length + 3);
  });
});

describe("NotesStore version history", () => {
  const A = noteId(1);

  const setup = async () => {
    let clock = NOW;
    const adapter = createMemoryStorageAdapter();
    const store = await createTestStore(adapter, () => clock);
    await createNote(store, A, { title: "Draft", blocks: [paragraph(text("first"))] });
    const save = (body: string, title = "Draft") =>
      store.saveNote(A, { title, ...bodyPatch(paragraph(text(body))) });
    const advance = (ms: number) => (clock += ms);
    const bodyOf = async () =>
      JSON.stringify((await store.getNote(A)).blocksByTab).match(/"text":"(\w+)"/)?.[1];
    return { store, adapter, save, advance, bodyOf };
  };

  it("keeps the content each editing session started from", async () => {
    const { store, save, advance } = await setup();
    await save("second");
    advance(MINUTE);
    await save("third");
    advance(15 * MINUTE);
    await save("fourth");

    const history = await store.getNoteHistory(A);
    expect(history.versions).toHaveLength(2);
    const bodies = await Promise.all(
      history.versions.map(async (version) =>
        JSON.stringify((await store.getNoteVersion(A, version.id)).note.blocksByTab),
      ),
    );
    expect(bodies[0]).toContain("third");
    expect(bodies[1]).toContain("first");
  });

  it("keeps the last content before a delete", async () => {
    const { store, save } = await setup();
    await save("second");
    await store.deleteNote(A);
    const [latest] = (await store.getNoteHistory(A)).versions;
    expect(JSON.stringify((await store.getNoteVersion(A, latest!.id)).note)).toContain("second");
  });

  it("restores a version, keeping what it replaced", async () => {
    const { store, save, advance, bodyOf } = await setup();
    await save("second", "Renamed");
    const [original] = (await store.getNoteHistory(A)).versions;

    advance(MINUTE);
    await store.restoreNoteVersion(A, original!.id);
    expect(await bodyOf()).toBe("first");
    expect((await store.getNote(A)).title).toBe("Draft");

    // The restore kept the content it replaced, so restoring that undoes it.
    const [undo] = (await store.getNoteHistory(A)).versions;
    await store.restoreNoteVersion(A, undo!.id);
    expect(await bodyOf()).toBe("second");
    expect((await store.getNote(A)).title).toBe("Renamed");
  });

  it("refuses a version that belongs to another note", async () => {
    const { store, save } = await setup();
    await save("second");
    const [version] = (await store.getNoteHistory(A)).versions;
    await expect(store.getNoteVersion(noteId(2), version!.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(store.restoreNoteVersion(noteId(2), version!.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("deletes the versions retention drops", async () => {
    const { store, adapter, save, advance } = await setup();
    for (let index = 0; index < 110; index += 1) {
      advance(11 * MINUTE);
      await save(`edit${index}`);
    }
    expect((await store.getNoteHistory(A)).versions).toHaveLength(100);
    expect(await adapter.list("revisions")).toHaveLength(100);
  });
});
