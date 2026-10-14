// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LoamBridgeParams } from "@loam/shared/bridge/loamBridge";

import { installFakeBridge } from "../../testing/fakeBridge";
import type { NoteDocument } from "../types";

/** Stands in for the store's `notes.save`. */
const api = { saveNote: vi.fn() };
const notFound = () => Object.assign(new Error("gone"), { code: "NOT_FOUND" });

installFakeBridge({
  "notes.save": ({ noteId, patch, baseUpdatedAt }: LoamBridgeParams<"notes.save">) =>
    api.saveNote(noteId, patch, baseUpdatedAt),
});

const DRAFTS_KEY = "loam:unsaved-edits";
/** The version `note()` was read at. */
const BASE = "2026-10-11T00:00:00.000Z";
const RETRY_KEY = "loam:unsaved-edits-retry";

const note = (overrides: Partial<NoteDocument> = {}): NoteDocument => ({
  id: "note-1",
  title: "Plan",
  updatedAt: "2026-10-11T00:00:00.000Z",
  tabs: [{ id: "t1", title: "Notes", kind: "page" }],
  blocksByTab: {
    t1: [{ id: "b1", type: "paragraph", content: [{ type: "text", text: "Body", styles: {} }] }],
  },
  activeTabId: "t1",
  graphsByTab: {},
  tablesByTab: {},
  ...overrides,
});

/** The module keeps state per window, so each test gets a fresh copy. */
const loadSaves = async () => {
  vi.resetModules();
  return import("../noteSaves");
};

const deferred = () => {
  let resolve!: (value: unknown) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  api.saveNote.mockReset().mockResolvedValue({ updatedAt: "later" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("noteSaves", () => {
  it("saves the fields that changed after a pause, once for several edits", async () => {
    const saves = await loadSaves();
    saves.recordNoteEdit(note({ title: "Pl" }), ["title"]);
    saves.recordNoteEdit(note({ title: "Plan B" }), ["title"]);
    expect(saves.readNoteSaveStatus("note-1")).toBe("unsaved");
    expect(api.saveNote).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(800);

    expect(api.saveNote).toHaveBeenCalledTimes(1);
    expect(api.saveNote).toHaveBeenCalledWith("note-1", { title: "Plan B" }, BASE);
    expect(saves.readNoteSaveStatus("note-1")).toBe("saved");
    expect(saves.readNoteSaveStatus("note-1")).toBe("saved");
  });

  it("sends normalized blocks when the body changed", async () => {
    const saves = await loadSaves();
    saves.recordNoteEdit(note(), ["blocksByTab"]);
    await saves.saveNoteEdits("note-1");

    const [, patch] = api.saveNote.mock.calls[0]!;
    expect(Object.keys(patch)).toEqual(["blocksByTab"]);
    expect(patch.blocksByTab.t1[0]).toMatchObject({ id: "b1", type: "paragraph", children: [] });
  });

  it("keeps one save in flight and saves edits made meanwhile after it", async () => {
    const saves = await loadSaves();
    const first = deferred();
    api.saveNote.mockReturnValueOnce(first.promise);
    saves.recordNoteEdit(note({ title: "One" }), ["title"]);
    const saving = saves.saveNoteEdits("note-1");
    expect(saves.readNoteSaveStatus("note-1")).toBe("saving");

    saves.recordNoteEdit(note({ title: "Two" }), ["title"]);
    expect(api.saveNote).toHaveBeenCalledTimes(1);
    first.resolve({ updatedAt: "later" });
    await saving;

    expect(api.saveNote).toHaveBeenCalledTimes(2);
    expect(api.saveNote).toHaveBeenLastCalledWith("note-1", { title: "Two" }, "later");
    expect(saves.readNoteSaveStatus("note-1")).toBe("saved");
  });

  it("keeps a failed save's edits and saves them on the next try", async () => {
    const saves = await loadSaves();
    api.saveNote.mockRejectedValueOnce(new Error("disk full"));
    saves.recordNoteEdit(note({ title: "Kept" }), ["title"]);

    await expect(saves.saveNoteEdits("note-1")).rejects.toThrow("disk full");
    expect(saves.readNoteSaveStatus("note-1")).toBe("failed");

    await saves.saveNoteEdits("note-1");
    expect(api.saveNote).toHaveBeenLastCalledWith("note-1", { title: "Kept" }, BASE);
    expect(saves.readNoteSaveStatus("note-1")).toBe("saved");
  });

  it("drops edits to a note the store no longer has", async () => {
    const saves = await loadSaves();
    api.saveNote.mockRejectedValueOnce(notFound());
    saves.recordNoteEdit(note(), ["title"]);
    await expect(saves.saveNoteEdits("note-1")).rejects.toThrow("gone");
    expect(saves.readNoteSaveStatus("note-1")).toBe("saved");
  });

  it("forgets edits to a note being deleted", async () => {
    const saves = await loadSaves();
    saves.recordNoteEdit(note(), ["title"]);
    saves.discardNoteEdits("note-1");
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.saveNote).not.toHaveBeenCalled();
    expect(saves.readNoteSaveStatus("note-1")).toBe("saved");
  });

  it("calls saved listeners after each successful save, with any conflict copy", async () => {
    const saves = await loadSaves();
    const saved = vi.fn();
    saves.onNoteSaved(saved);
    saves.recordNoteEdit(note(), ["title"]);
    await saves.saveNoteEdits();
    expect(saved).toHaveBeenCalledWith("note-1", undefined);

    const copy = { id: "copy-1", title: "Plan (conflict copy)" };
    api.saveNote.mockResolvedValueOnce({ updatedAt: "latest", conflictCopy: copy });
    saves.recordNoteEdit(note(), ["title"]);
    await saves.saveNoteEdits();
    expect(saved).toHaveBeenLastCalledWith("note-1", copy);
  });

  it("names the version each save's edits were made to", async () => {
    const saves = await loadSaves();
    saves.recordNoteEdit(note(), ["title"]);
    await saves.saveNoteEdits();
    expect(api.saveNote).toHaveBeenLastCalledWith("note-1", { title: "Plan" }, BASE);

    // The next save builds on the version the store returned…
    saves.recordNoteEdit(note(), ["title"]);
    await saves.saveNoteEdits();
    expect(api.saveNote).toHaveBeenLastCalledWith("note-1", { title: "Plan" }, "later");

    // …or on the one the window read since.
    saves.noteRead(note({ updatedAt: "synced" }));
    saves.recordNoteEdit(note(), ["title"]);
    await saves.saveNoteEdits();
    expect(api.saveNote).toHaveBeenLastCalledWith("note-1", { title: "Plan" }, "synced");
  });
});

describe("noteSaves across a window close", () => {
  it("keeps unsaved edits in localStorage and saves them on the next launch", async () => {
    let saves = await loadSaves();
    saves.recordNoteEdit(note({ title: "Typed just before quitting" }), ["title"]);
    expect(saves.keepUnsavedEditsOnClose()).toBe(true);
    expect(JSON.parse(localStorage.getItem(DRAFTS_KEY)!)).toEqual({
      "note-1": { patch: { title: "Typed just before quitting" }, base: BASE },
    });

    saves = await loadSaves();
    await saves.saveEditsFromLastSession();
    expect(api.saveNote).toHaveBeenCalledWith(
      "note-1",
      { title: "Typed just before quitting" },
      BASE,
    );
    expect(localStorage.getItem(DRAFTS_KEY)).toBeNull();
  });

  it("clears the kept edits the moment they are saved", async () => {
    const saves = await loadSaves();
    saves.recordNoteEdit(note({ title: "Draft" }), ["title"]);
    await vi.advanceTimersByTimeAsync(300);
    expect(localStorage.getItem(DRAFTS_KEY)).not.toBeNull();

    await saves.saveNoteEdits("note-1");
    // No timer needed: an older draft must never outlive the save that replaced it.
    expect(localStorage.getItem(DRAFTS_KEY)).toBeNull();
  });

  it("skips kept edits for notes deleted since, including ones an older version kept", async () => {
    localStorage.setItem(
      DRAFTS_KEY,
      JSON.stringify({ gone: { title: "Gone" }, other: { title: "Other" } }),
    );
    const saves = await loadSaves();
    api.saveNote.mockRejectedValueOnce(notFound());
    await saves.saveEditsFromLastSession();
    expect(api.saveNote).toHaveBeenLastCalledWith("other", { title: "Other" }, undefined);
    expect(localStorage.getItem(DRAFTS_KEY)).toBeNull();
  });

  it("keeps edits a launch couldn't save apart, and saves them on a later launch", async () => {
    localStorage.setItem(
      DRAFTS_KEY,
      JSON.stringify({
        busy: { patch: { title: "Busy" }, base: "v1" },
        fine: { patch: { title: "Fine" }, base: "v2" },
      }),
    );
    let saves = await loadSaves();
    api.saveNote.mockRejectedValueOnce(new Error("busy"));
    await saves.saveEditsFromLastSession();
    expect(api.saveNote).toHaveBeenCalledWith("fine", { title: "Fine" }, "v2");
    expect(localStorage.getItem(DRAFTS_KEY)).toBeNull();

    // This session's own kept edits never replace them.
    saves.recordNoteEdit(note({ title: "New" }), ["title"]);
    await saves.saveNoteEdits();
    expect(JSON.parse(localStorage.getItem(RETRY_KEY)!)).toEqual({
      busy: { patch: { title: "Busy" }, base: "v1" },
    });

    api.saveNote.mockClear();
    saves = await loadSaves();
    await saves.saveEditsFromLastSession();
    expect(api.saveNote).toHaveBeenCalledWith("busy", { title: "Busy" }, "v1");
    expect(localStorage.getItem(RETRY_KEY)).toBeNull();
  });

  it("drops an edit an earlier launch couldn't save once the note is saved again", async () => {
    localStorage.setItem(RETRY_KEY, JSON.stringify({ "note-1": { title: "Old" } }));
    const saves = await loadSaves();
    saves.recordNoteEdit(note({ title: "Newer" }), ["title"]);
    await saves.saveNoteEdits("note-1");
    expect(localStorage.getItem(RETRY_KEY)).toBeNull();
  });

  it("writes kept edits right away when edits are discarded", async () => {
    const saves = await loadSaves();
    saves.recordNoteEdit(note({ title: "Draft" }), ["title"]);
    await vi.advanceTimersByTimeAsync(300);
    saves.discardNoteEdits("note-1");
    expect(localStorage.getItem(DRAFTS_KEY)).toBeNull();
  });
});
