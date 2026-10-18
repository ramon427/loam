import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NotesStore } from "@loam/storage/NotesStore";
import {
  createNote,
  createTestStore,
  noteId,
  paragraph,
  text,
} from "@loam/storage/testing/storeFixtures";

import type { OpenLibrary } from "../library";
import { createPlugins } from "../plugins/plugins";

let dataDirectory: string;
let store: NotesStore;
let locked: boolean;

const writePlugin = async (
  id: string,
  manifest: Record<string, unknown> = {},
  code = "",
  parent = join(dataDirectory, "plugins"),
) => {
  const folder = join(parent, id);
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, "manifest.json"),
    JSON.stringify({ id, name: id, version: "1.0.0", apiVersion: 1, ...manifest }),
  );
  await writeFile(join(folder, "main.js"), code || "export const register = () => {};");
};

const create = (google?: Parameters<typeof createPlugins>[0]["google"]) =>
  createPlugins({
    dataDirectory,
    bundledDirectory: join(dataDirectory, "bundled"),
    google,
    library: () => {
      if (locked) throw new Error("Your notes are locked.");
      return { store } as unknown as OpenLibrary;
    },
    onChange: () => undefined,
  });

/** A plugins service with `id` installed, switched on with every permission it asks for. */
const running = async (id: string, permissions: string[]) => {
  await writePlugin(id, { permissions });
  const plugins = create();
  await plugins.setRestricted(false);
  await plugins.setEnabled(id, true, permissions);
  return plugins;
};

beforeEach(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "loam-plugins-"));
  store = await createTestStore();
  locked = false;
});

afterEach(async () => {
  await rm(dataDirectory, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe("plugins", () => {
  it("lists plugin folders, saying why one can't be used", async () => {
    await writePlugin("word-count", { permissions: ["notes:read"] });
    await writePlugin("bad-perms", { permissions: ["everything"] });
    await mkdir(join(dataDirectory, "plugins", "no-manifest"));
    await writePlugin("misnamed", { id: "other" });

    const list = await create().list();

    expect(list.restrictedMode).toBe(true);
    expect(list.plugins.map((plugin) => [plugin.folder, plugin.ok ? "ok" : plugin.error])).toEqual([
      ["bad-perms", "permissions.0: Unknown permission"],
      ["misnamed", "The folder must be named after the plugin's id, other."],
      ["no-manifest", "The folder has no manifest.json."],
      ["word-count", "ok"],
    ]);
  });

  it("keeps what was allowed in plugins.json, granting only permissions the plugin asks for", async () => {
    await writePlugin("word-count", { permissions: ["notes:read"] });
    const plugins = create();
    await plugins.setRestricted(false);
    await plugins.setEnabled("word-count", true, ["notes:read", "notes:write"]);

    const saved = JSON.parse(await readFile(join(dataDirectory, "plugins.json"), "utf8"));
    expect(saved).toEqual({
      restrictedMode: false,
      plugins: { "word-count": { enabled: true, granted: ["notes:read"], settings: {} } },
    });
    expect((await create().list()).plugins[0]).toMatchObject({
      enabled: true,
      granted: ["notes:read"],
    });
  });

  it("gives a plugin's module only while it is on and restricted mode is off", async () => {
    await writePlugin("word-count", {}, "export const register = () => 1;");
    const plugins = create();
    await expect(plugins.source("word-count")).rejects.toMatchObject({
      code: "PLUGIN_NOT_ALLOWED",
    });
    await plugins.setEnabled("word-count", true);
    await expect(plugins.source("word-count")).rejects.toMatchObject({
      code: "PLUGIN_NOT_ALLOWED",
    });
    await plugins.setRestricted(false);
    await expect(plugins.source("word-count")).resolves.toEqual({
      code: "export const register = () => 1;",
    });
  });

  it("reads notes as plain text for a plugin granted notes:read", async () => {
    await createNote(store, noteId(1), {
      title: "Groceries",
      blocks: [paragraph(text("Milk")), paragraph(text("Eggs"))],
    });
    const plugins = await running("reader", ["notes:read"]);

    await expect(plugins.call("reader", "notes.get", { noteId: noteId(1) })).resolves.toMatchObject(
      {
        id: noteId(1),
        title: "Groceries",
        text: "Milk\nEggs",
      },
    );
    await expect(plugins.call("reader", "notes.list", {})).resolves.toEqual([
      expect.objectContaining({ id: noteId(1), title: "Groceries" }),
    ]);
  });

  it("refuses an operation the plugin was not granted", async () => {
    const plugins = await running("reader", ["notes:read"]);
    await expect(
      plugins.call("reader", "notes.create", { title: "x", blocks: [] }),
    ).rejects.toMatchObject({ code: "PLUGIN_NOT_ALLOWED" });
  });

  it("creates, retitles, appends to and trashes notes for a plugin granted notes:write", async () => {
    const plugins = await running("writer", ["notes:read", "notes:write"]);
    const created = (await plugins.call("writer", "notes.create", {
      title: "Daily",
      blocks: [paragraph(text("One"))],
    })) as { id: string };

    await plugins.call("writer", "notes.setTitle", { noteId: created.id, title: "Today" });
    await plugins.call("writer", "notes.append", {
      noteId: created.id,
      blocks: [paragraph(text("Two"))],
    });
    await expect(
      plugins.call("writer", "notes.get", { noteId: created.id }),
    ).resolves.toMatchObject({
      title: "Today",
      text: "One\nTwo",
    });

    await plugins.call("writer", "notes.trash", { noteId: created.id });
    await expect(store.getNote(created.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("checks an operation's params", async () => {
    const plugins = await running("reader", ["notes:read"]);
    await expect(plugins.call("reader", "notes.get", { noteId: 5 })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("reads nothing while notes are locked", async () => {
    const plugins = await running("reader", ["notes:read"]);
    locked = true;
    await expect(plugins.call("reader", "notes.list", {})).rejects.toThrow("locked");
  });

  it("fetches only https addresses on hosts the plugin was granted, without following redirects", async () => {
    const fetch = vi.fn(async () => new Response("hello", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const plugins = await running("weather", ["network:api.weather.test"]);

    await expect(
      plugins.fetch("weather", { url: "https://api.weather.test/today" }),
    ).resolves.toMatchObject({ status: 200, body: "hello" });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.weather.test/today",
      expect.objectContaining({ redirect: "manual", credentials: "omit" }),
    );
    for (const url of [
      "http://api.weather.test/today",
      "https://evil.test/",
      "https://api.weather.test.evil.test/",
    ])
      await expect(plugins.fetch("weather", { url })).rejects.toMatchObject({
        code: "PLUGIN_NOT_ALLOWED",
      });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("stops reading a response once it is over 5 MB", async () => {
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(endless, { status: 200 })),
    );
    const plugins = await running("weather", ["network:api.weather.test"]);

    await expect(
      plugins.fetch("weather", { url: "https://api.weather.test/huge" }),
    ).rejects.toMatchObject({ code: "PLUGIN_TOO_LARGE" });
    expect(pulled).toBeLessThan(10);
  });

  it("keeps each plugin's stored values apart, across restarts", async () => {
    await writePlugin("other");
    const plugins = await running("counter", []);
    await plugins.setEnabled("other", true);

    await plugins.storeSet("counter", "count", 3);
    expect(await create().storeGet("counter", "count")).toBe(3);
    expect(await plugins.storeGet("other", "count")).toBeNull();
  });

  it("lets only plugins granted google:calendar reach the Google account", async () => {
    const google = {
      status: vi.fn(async () => ({
        state: "signed-in" as const,
        email: "me@gmail.com",
        clientId: "secret-client",
        hasClientSecret: true,
        error: null,
        canEncrypt: true,
      })),
      signIn: vi.fn(),
      calendar: vi.fn(async () => ({ status: 200, headers: {}, body: "{}" })),
    };
    await writePlugin("calendar", { permissions: ["google:calendar"] });
    await writePlugin("other", { permissions: ["ui"] });
    const plugins = create(google);
    await plugins.setRestricted(false);
    await plugins.setEnabled("calendar", true, ["google:calendar"]);
    await plugins.setEnabled("other", true, ["ui"]);

    // A plugin learns whether it is signed in, never the client.
    await expect(plugins.googleStatus("calendar")).resolves.toEqual({
      state: "signed-in",
      email: "me@gmail.com",
    });
    await plugins.googleCalendar("calendar", { path: "/users/me/calendarList" });
    expect(google.calendar).toHaveBeenCalledWith({ path: "/users/me/calendarList" });
    await expect(
      plugins.googleCalendar("other", { path: "/users/me/calendarList" }),
    ).rejects.toMatchObject({
      code: "PLUGIN_NOT_ALLOWED",
    });
    await expect(plugins.googleSignIn("other")).rejects.toMatchObject({
      code: "PLUGIN_NOT_ALLOWED",
    });
    expect(google.calendar).toHaveBeenCalledTimes(1);
    expect(google.signIn).not.toHaveBeenCalled();
  });

  it("saves a setting only when the manifest declares it with that type", async () => {
    await writePlugin("daily", {
      settings: [{ key: "folder", type: "string", label: "Folder", default: "Daily" }],
    });
    const plugins = create();
    await plugins.setSetting("daily", "folder", "Journal");
    await expect(plugins.setSetting("daily", "folder", 3)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(plugins.setSetting("daily", "nope", "x")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect((await plugins.list()).plugins[0]).toMatchObject({ settings: { folder: "Journal" } });
  });

  it("lists the plugins that ship with the app, letting a plugins folder of the same name win", async () => {
    const bundled = join(dataDirectory, "bundled");
    await writePlugin("calendar", {}, "export const register = () => 'bundled';", bundled);
    await writePlugin("todos", {}, "export const register = () => 'bundled';", bundled);
    await writePlugin("todos", {}, "export const register = () => 'mine';");
    const plugins = create();

    expect((await plugins.list()).plugins.map((plugin) => [plugin.folder, plugin.bundled])).toEqual(
      [
        ["calendar", true],
        ["todos", false],
      ],
    );
    await plugins.setRestricted(false);
    await plugins.setEnabled("calendar", true);
    await plugins.setEnabled("todos", true);
    await expect(plugins.source("calendar")).resolves.toEqual({
      code: "export const register = () => 'bundled';",
    });
    await expect(plugins.source("todos")).resolves.toEqual({
      code: "export const register = () => 'mine';",
    });
  });
});
