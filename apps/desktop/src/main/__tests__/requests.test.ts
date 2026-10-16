import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { LOAM_BRIDGE_METHODS, type LoamBridgeMethod } from "@loam/shared/bridge/loamBridge";
import { createNote, createTestStore, newNote, noteId } from "@loam/storage/testing/storeFixtures";

import { createWorkspaceRequests } from "../workspaceRequests";
import { createMediaStore } from "../mediaStore";
import type { AppServices } from "../requests/handlers";
import type { MainWindow } from "../window";
import { createTestApp, TEST_PASSPHRASE } from "./appFixture";

const invalid = { ok: false, error: { code: "VALIDATION_ERROR", status: 400 } };

describe("requests", () => {
  it("creates, saves and reads notes, and keeps store failures' codes", async () => {
    const { dispatch } = await createTestApp(await createTestStore());
    await expect(
      dispatch("notes.create", { note: newNote(noteId(1)) }, "window"),
    ).resolves.toMatchObject({
      ok: true,
      data: { id: noteId(1), contentState: "full" },
    });
    await expect(
      dispatch("notes.save", { noteId: noteId(1), patch: { title: "Renamed" } }, "window"),
    ).resolves.toMatchObject({ ok: true, data: { updatedAt: expect.any(String) } });
    await expect(dispatch("notes.library", {}, "window")).resolves.toMatchObject({
      ok: true,
      data: { notes: [expect.objectContaining({ title: "Renamed" })] },
    });
    await expect(dispatch("notes.get", { noteId: noteId(9) }, "window")).resolves.toEqual({
      ok: false,
      error: { code: "NOT_FOUND", message: "The note no longer exists.", status: 404 },
    });
  });

  it("checks params before a request runs", async () => {
    const store = await createTestStore();
    const { dispatch } = await createTestApp(store);
    await expect(dispatch("notes.get", { noteId: 42 }, "window")).resolves.toMatchObject(invalid);
    await expect(
      dispatch("notes.get", { noteId: "x".repeat(513) }, "window"),
    ).resolves.toMatchObject(invalid);
    await expect(dispatch("notes.get", undefined, "window")).resolves.toMatchObject(invalid);
    await expect(dispatch("import.pick", { source: "dropbox" }, "window")).resolves.toMatchObject(
      invalid,
    );
    await expect(dispatch("notes.create", { note: "not-a-note" }, "window")).resolves.toMatchObject(
      invalid,
    );
    await expect(
      dispatch("mcp.configure", { enabled: true, port: 80 }, "window"),
    ).resolves.toMatchObject(invalid);
    await expect(
      dispatch("import.images", { sessionId: "s", requests: [{ fromPath: 1 }] }, "window"),
    ).resolves.toMatchObject(invalid);
    expect((await store.getLibrary()).notes).toEqual([]);
  });

  it("imports dropped paths only once the user confirms them in a system dialog", async () => {
    const asked: string[][] = [];
    const { dispatch } = await createTestApp(await createTestStore(), {
      dialogs: {
        confirmDroppedImport: async (paths: readonly string[]) => {
          asked.push([...paths]);
          return false;
        },
      } as unknown as AppServices["dialogs"],
    });
    await expect(
      dispatch("import.pickDropped", { paths: ["/home/me/Vault"] }, "window"),
    ).resolves.toMatchObject({ ok: true, data: { status: "canceled" } });
    expect(asked).toEqual([["/home/me/Vault"]]);
  });

  it("never takes a file path from the window, only from its own pickers", async () => {
    const { dispatch } = await createTestApp(await createTestStore());
    for (const [method, params] of [
      ["export.markdown", { scope: { kind: "all" }, parentDirectory: "/tmp" }],
      ["import.pick", { source: "markdown", paths: ["/tmp"] }],
      ["sync.chooseFolder", { folder: "/tmp" }],
      ["backups.restoreFile", { path: "/tmp/backup.json.gz" }],
      ["security.saveRecoveryKey", { path: "/tmp/key.txt" }],
    ] as const)
      await expect(dispatch(method, params, "window")).resolves.toMatchObject(invalid);
  });

  it("limits searches to 50 results a page and 200 characters", async () => {
    const store = await createTestStore();
    for (let index = 1; index <= 3; index += 1)
      await createNote(store, noteId(index), { title: `Topic ${index}` });
    const { dispatch } = await createTestApp(store);
    await expect(
      dispatch("notes.search", { query: "topic", limit: 51 }, "window"),
    ).resolves.toMatchObject(invalid);
    await expect(
      dispatch("notes.search", { query: "topic", limit: 1 }, "window"),
    ).resolves.toMatchObject({ ok: true, data: { hasMore: true, results: [expect.anything()] } });
    await expect(
      dispatch("notes.search", { query: `topic${" ".repeat(300)}missing` }, "window"),
    ).resolves.toMatchObject({ ok: true, data: { results: expect.any(Array) } });
  });

  it("refuses to reset the passphrase of notes that are already unlocked", async () => {
    const { dispatch } = await createTestApp(await createTestStore(), { locked: true });
    await dispatch("security.unlock", { passphrase: TEST_PASSPHRASE }, "window");
    await expect(
      dispatch(
        "security.resetPassphrase",
        { recoveryKey: TEST_PASSPHRASE, passphrase: "new passphrase" },
        "window",
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "CONFLICT" } });
  });
});

describe("a locked library", () => {
  const allowedWhileLocked = {
    window: [
      "security.status",
      "security.unlock",
      "security.resetPassphrase",
      "app.setTheme",
      "customizations.list",
    ],
    ai: ["security.status"],
  } as const;

  it("answers each caller only the requests it may make while locked", async () => {
    const store = await createTestStore();
    await createNote(store, noteId(1), { title: "Secret" });
    const { dispatch } = await createTestApp(store, { locked: true });
    for (const caller of ["window", "ai"] as const) {
      const allowed: readonly LoamBridgeMethod[] = allowedWhileLocked[caller];
      for (const method of LOAM_BRIDGE_METHODS.filter((method) => !allowed.includes(method)))
        await expect(dispatch(method, {}, caller), `${caller} ${method}`).resolves.toEqual({
          ok: false,
          error: { code: "LOCKED", message: "Your notes are locked.", status: 423 },
        });
      await expect(dispatch("security.status", {}, caller)).resolves.toEqual({
        ok: true,
        data: { state: "locked" },
      });
    }
    await expect(
      dispatch("security.unlock", { passphrase: "wrong passphrase" }, "window"),
    ).resolves.toMatchObject({ ok: false, error: { code: "WRONG_PASSPHRASE" } });
  });

  it("opens to both callers once the window unlocks it", async () => {
    const store = await createTestStore();
    await createNote(store, noteId(1), { title: "Secret" });
    const { dispatch } = await createTestApp(store, { locked: true });
    await expect(
      dispatch("security.unlock", { passphrase: TEST_PASSPHRASE }, "window"),
    ).resolves.toEqual({ ok: true, data: { state: "on" } });
    for (const caller of ["window", "ai"] as const)
      await expect(dispatch("notes.library", {}, caller)).resolves.toMatchObject({
        ok: true,
        data: { notes: [expect.objectContaining({ title: "Secret" })] },
      });
  });
});

describe("workspace requests", () => {
  it("has nothing to save when no window is open", async () => {
    const sent: unknown[] = [];
    const workspace = createWorkspaceRequests({
      send: (request) => {
        sent.push(request);
        return false;
      },
      isWindowReady: () => false,
    });
    await expect(workspace.flush()).resolves.toBeUndefined();
    expect(sent).toEqual([]);
    await expect(workspace.request({ action: "status" })).rejects.toMatchObject({
      code: "WINDOW_UNAVAILABLE",
    });
  });
});

describe("image requests", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  it("copies a note's image to the clipboard, read from the media folder by its name only", async () => {
    const directory = mkdtempSync(join(tmpdir(), "loam-requests-"));
    try {
      const media = createMediaStore(directory);
      const { path } = await media.saveImage(png);
      const copied: Uint8Array[] = [];
      let canHold = true;
      const window = {
        copyImage: (bytes: Uint8Array) => {
          if (canHold) copied.push(new Uint8Array(bytes));
          return canHold;
        },
      } as unknown as MainWindow;
      const { dispatch } = await createTestApp(await createTestStore(), { media, window });

      await expect(dispatch("media.copyImage", { reference: path }, "window")).resolves.toEqual({
        ok: true,
        data: null,
      });
      expect(copied).toEqual([png]);

      for (const reference of ["../notes.db", "/etc/passwd", join(directory, path)])
        await expect(dispatch("media.copyImage", { reference }, "window")).resolves.toMatchObject(
          invalid,
        );
      // A name of the same form that no image has: the saved one with its first character changed.
      const missing = `${path.startsWith("0") ? "1" : "0"}${path.slice(1)}`;
      await expect(
        dispatch("media.copyImage", { reference: missing }, "window"),
      ).resolves.toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });

      canHold = false;
      await expect(dispatch("media.copyImage", { reference: path }, "window")).resolves.toEqual({
        ok: false,
        error: {
          code: "MEDIA_TYPE_UNSUPPORTED",
          message: "This image can't be copied.",
          status: 415,
        },
      });
      expect(copied).toHaveLength(1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
