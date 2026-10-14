import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";

import type {
  NoteDocument,
  NoteFolder,
  NoteProject,
  NotesBootstrap,
} from "@loam/shared/notes/noteModel";
import type { StoreChange } from "@loam/storage/NotesStore";
import {
  createTestStore,
  newNote,
  noteId,
  paragraph,
  text,
  noteLink,
} from "@loam/storage/testing/storeFixtures";

import { createLoamMcpServer } from "../mcp/server";
import { createMcpTools } from "../mcp/tools";
import { createTestApp } from "./appFixture";

const close: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of close.splice(0)) await dispose();
});

const setup = async ({ locked = false } = {}) => {
  const store = await createTestStore();
  const changes: StoreChange[] = [];
  store.onChange((change) => changes.push(change));
  const { app, dispatch } = await createTestApp(store, { locked });
  const tools = createMcpTools({ dispatch, app });
  const server = createLoamMcpServer({ tools, version: "test" });
  const client = new Client({ name: "test", version: "1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  close.push(async () => {
    await client.close();
    await server.close();
    await store.close();
  });
  const call = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
    const result = await client.callTool({ name, arguments: args });
    if (result.isError) throw new Error(JSON.stringify(result));
    return (result.structuredContent as { data: T }).data;
  };
  return { store, server, client, call, changes, tools };
};

describe("Loam MCP tools", () => {
  it("keeps AI access settings and the window's own requests away from AI clients", async () => {
    const { client } = await setup();
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const windowOnly of [
      "loam_mcp_configure",
      "loam_mcp_connection",
      "loam_mcp_rotate_token",
      "loam_app_automation_result",
      "loam_import_pick",
      "loam_security_unlock",
      "loam_security_reset_passphrase",
    ])
      expect(names).not.toContain(windowOnly);
  });

  it("answers only the encryption status while the library is locked", async () => {
    const { client, store, tools } = await setup({ locked: true });
    await store.createNote(newNote(noteId(1), { title: "Secret" }));
    // Whatever the input, before it is even checked.
    for (const tool of tools.filter(({ name }) => name !== "loam_security_status"))
      await expect(tool.run({}), tool.name).rejects.toMatchObject({ code: "LOCKED" });
    const result = await client.callTool({ name: "loam_notes_library", arguments: {} });
    expect(result.structuredContent).toMatchObject({ error: { code: "LOCKED" } });
    expect(
      (await client.callTool({ name: "loam_security_status", arguments: {} })).structuredContent,
    ).toEqual({ data: { state: "locked" } });
    await expect(client.readResource({ uri: "loam://library" })).rejects.toThrow();
  });

  it("discovers usable JSON schemas, annotations, resources and full content instructions", async () => {
    const { client } = await setup();
    const { tools } = await client.listTools();
    const save = tools.find((tool) => tool.name === "loam_notes_save")!;
    expect(save.inputSchema.required).toContain("baseUpdatedAt");
    expect(tools.find((tool) => tool.name === "loam_notes_get")!.annotations?.readOnlyHint).toBe(
      true,
    );
    expect(
      tools.find((tool) => tool.name === "loam_backups_restore")!.annotations?.destructiveHint,
    ).toBe(true);
    const guide = await client.readResource({ uri: "loam://guide" });
    expect(guide.contents[0]).toHaveProperty("text", expect.stringContaining("BlockNote"));
    expect((await client.listResourceTemplates()).resourceTemplates[0]!.uriTemplate).toBe(
      "loam://notes/{noteId}",
    );
  });

  it("creates, edits, searches, links, deletes and restores through the real store", async () => {
    const { call } = await setup();
    const target = await call<NoteDocument>("loam_notes_create", {
      note: newNote(noteId(1), { title: "Target" }),
    });
    const source = await call<NoteDocument>("loam_notes_create", {
      note: newNote(noteId(2), {
        title: "Source",
        blocks: [paragraph(noteLink(target.id, "Target"))],
      }),
    });
    await call("loam_notes_save", {
      noteId: source.id,
      patch: { title: "Renamed source" },
      baseUpdatedAt: source.updatedAt,
    });
    expect(await call("loam_notes_backlinks", { noteId: target.id })).toMatchObject({
      noteCount: 1,
      notes: [{ id: source.id }],
    });
    expect(await call("loam_notes_search", { query: "Renamed" })).toMatchObject({
      results: [{ noteId: source.id }],
    });
    const deleted = await call<NoteDocument>("loam_notes_delete", { noteId: source.id });
    await call("loam_notes_restore", { note: deleted });
    expect(await call("loam_notes_get", { noteId: source.id })).toMatchObject({
      title: "Renamed source",
    });
    expect(await call("loam_notes_history", { noteId: source.id })).toMatchObject({
      versions: expect.any(Array),
    });
  });

  it("preserves unrelated content while editing diagrams, tables, blocks and video", async () => {
    const { call } = await setup();
    const original = await call<NoteDocument>("loam_notes_new", {
      title: "Multimedia",
      blocks: [paragraph(text("Preserve me"))],
    });
    const graphTab = await call<{ tabId: string }>("loam_tabs_add", {
      noteId: original.id,
      title: "Diagram",
      kind: "graph",
      baseUpdatedAt: original.updatedAt,
    });
    let note = await call<NoteDocument>("loam_notes_get", { noteId: original.id });
    await call("loam_graphs_import", {
      noteId: note.id,
      tabId: graphTab.tabId,
      baseUpdatedAt: note.updatedAt,
      format: "mermaid",
      text: "flowchart TD\n A[Start] --> B[Finish]",
    });
    note = await call<NoteDocument>("loam_notes_get", { noteId: original.id });
    const tableTab = await call<{ tabId: string }>("loam_tabs_add", {
      noteId: note.id,
      title: "Table",
      kind: "table",
      baseUpdatedAt: note.updatedAt,
    });
    note = await call<NoteDocument>("loam_notes_get", { noteId: original.id });
    await call("loam_tables_set", {
      noteId: note.id,
      tabId: tableTab.tabId,
      baseUpdatedAt: note.updatedAt,
      table: {
        columns: [{ id: "done", title: "Done", type: "boolean" }],
        rows: [{ id: "r1", cells: { done: true } }],
      },
    });
    note = await call<NoteDocument>("loam_notes_get", { noteId: original.id });
    await expect(
      call("loam_tabs_add", {
        noteId: note.id,
        title: "Draft",
        kind: "markdown",
        baseUpdatedAt: note.updatedAt,
      }),
    ).rejects.toThrow();
    await call("loam_video_set", {
      noteId: note.id,
      baseUpdatedAt: note.updatedAt,
      video: {
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        videoId: "dQw4w9WgXcQ",
        lastWatchedSeconds: 90,
      },
    });
    note = await call<NoteDocument>("loam_notes_get", { noteId: original.id });
    expect(JSON.stringify(note.blocksByTab)).toContain("Preserve me");
    expect(note.graphsByTab?.[graphTab.tabId]?.nodes).toHaveLength(2);
    expect(note.tablesByTab?.[tableTab.tabId]?.rows[0]?.cells.done).toBe(true);
    expect(note.video?.lastWatchedSeconds).toBe(90);
    expect(
      await call("loam_graphs_export", {
        noteId: note.id,
        tabId: graphTab.tabId,
        format: "jsoncanvas",
      }),
    ).toMatchObject({ text: expect.stringContaining("Start") });
  });

  it("adds, renames and removes folders and moves notes without replacing other entries", async () => {
    const { call } = await setup();
    const folder = await call<{ id: string }>("loam_folders_create", { name: "Projects" });
    const first = await call<NoteDocument>("loam_notes_new", { title: "First" });
    const second = await call<NoteDocument>("loam_notes_new", { title: "Second" });
    await call("loam_notes_move", { noteId: first.id, folderId: folder.id });
    await call("loam_folders_rename", { folderId: folder.id, name: "Work" });
    expect(await call("loam_notes_get", { noteId: first.id })).toMatchObject({
      folderId: folder.id,
    });
    await call("loam_folders_delete", { folderId: folder.id });
    const library = await call<{ notes: NoteDocument[]; folders: unknown[] }>("loam_notes_library");
    expect(library.folders).toEqual([]);
    expect(library.notes.map((n) => n.id)).toEqual(expect.arrayContaining([first.id, second.id]));
    expect(library.notes.every((n) => n.folderId === undefined)).toBe(true);
  });

  it("creates, changes, reorders and deletes projects, and moves folders and notes in and out", async () => {
    const { call, client } = await setup();
    const work = await call<NoteProject>("loam_projects_create", {
      name: "Work",
      icon: { kind: "symbol", value: "rocket", color: "green" },
    });
    expect(work).toMatchObject({ name: "Work", position: 0 });
    const home = await call<NoteProject>("loam_projects_create", { name: "Home" });
    const badIcon = await client.callTool({
      name: "loam_projects_create",
      arguments: { name: "Odd", icon: { kind: "emoji", value: "two words" } },
    });
    expect(badIcon.isError).toBe(true);

    const folder = await call<NoteFolder>("loam_folders_create", {
      name: "Plans",
      projectId: work.id,
    });
    const filed = await call<NoteDocument>("loam_notes_new", {
      title: "Filed",
      folderId: folder.id,
    });
    const loose = await call<NoteDocument>("loam_notes_new", {
      title: "Loose",
      projectId: home.id,
    });
    expect(loose.projectId).toBe(home.id);
    await call("loam_notes_move", { noteId: loose.id, folderId: null, projectId: work.id });
    await call("loam_projects_update", {
      projectId: home.id,
      name: "House",
      icon: { kind: "emoji", value: "🏠" },
    });
    let library = await call<NotesBootstrap>("loam_projects_move", {
      projectId: home.id,
      beforeProjectId: work.id,
    });
    expect(library.projects).toEqual([
      { id: home.id, name: "House", position: 0, icon: { kind: "emoji", value: "🏠" } },
      { ...work, position: 1 },
    ]);
    expect(library.notes.find((note) => note.id === loose.id)?.projectId).toBe(work.id);

    library = await call<NotesBootstrap>("loam_folders_delete", { folderId: folder.id });
    expect(library.notes.find((note) => note.id === filed.id)).toMatchObject({
      folderId: undefined,
      projectId: work.id,
    });
    const other = await call<NoteFolder>("loam_folders_create", {
      name: "Other",
      projectId: work.id,
    });
    await call("loam_folders_move", { folderId: other.id, projectId: home.id });
    library = await call<NotesBootstrap>("loam_projects_delete", { projectId: work.id });
    expect(library.projects.map((project) => project.id)).toEqual([home.id]);
    expect(library.folders).toEqual([
      { id: other.id, name: "Other", position: 0, projectId: home.id },
    ]);
    expect(library.notes.map((note) => note.projectId)).toEqual([undefined, undefined]);
  });

  it("rejects stale AI writes and preserves an AI version when a concurrent user edit saves", async () => {
    const { call, client, store } = await setup();
    const note = await call<NoteDocument>("loam_notes_new", { title: "Original" });
    await call("loam_notes_save", {
      noteId: note.id,
      patch: { title: "AI version" },
      baseUpdatedAt: note.updatedAt,
    });
    const stale = await client.callTool({
      name: "loam_notes_save",
      arguments: { noteId: note.id, patch: { title: "Stale AI" }, baseUpdatedAt: note.updatedAt },
    });
    expect(stale.isError).toBe(true);
    expect(stale.structuredContent).toMatchObject({ error: { code: "CONFLICT", status: 409 } });
    const userSave = await store.saveNote(note.id, { title: "User version" }, note.updatedAt);
    expect(userSave.conflictCopy).toBeTruthy();
    const library = await store.getLibrary();
    expect(library.notes.map((n) => n.title)).toEqual(
      expect.arrayContaining(["User version", "AI version (conflict copy)"]),
    );
  });

  it("tells the window about notes an AI client changes, including one restored from Trash", async () => {
    const { call, changes } = await setup();
    const note = await call<NoteDocument>("loam_notes_new", { title: "Kept" });
    await call("loam_notes_delete", { noteId: note.id });
    changes.length = 0;
    await call("loam_notes_restore_trash", { noteId: note.id });
    expect(changes).toEqual([
      expect.objectContaining({ external: true, changedNoteIds: [note.id], layoutChanged: true }),
    ]);
  });

  it("only takes absolute paths from AI clients", async () => {
    const { client } = await setup();
    const result = await client.callTool({
      name: "loam_export_markdown",
      arguments: { scope: { kind: "all" }, parentDirectory: "relative/folder" },
    });
    expect(result.isError).toBe(true);
  });

  it("rejects malformed inputs before invoking app operations", async () => {
    const { client, store } = await setup();
    const result = await client.callTool({
      name: "loam_notes_create",
      arguments: { note: { title: "Invalid", tabs: [] } },
    });
    expect(result.isError).toBe(true);
    expect((await store.getLibrary()).notes).toEqual([]);
    const { tools } = await client.listTools();
    const create = tools.find((tool) => tool.name === "loam_notes_create")!;
    expect(JSON.stringify(create.inputSchema)).toContain("pattern");
    const namedId = await client.callTool({
      name: "loam_notes_create",
      arguments: { note: { ...newNote(noteId(1)), id: "my-note" } },
    });
    expect(namedId.isError).toBe(true);
    expect(JSON.stringify(namedId.content)).toContain("UUID");
    expect((await store.getLibrary()).notes).toEqual([]);
    const unknown = await client.callTool({ name: "loam_mcp_connection", arguments: {} });
    expect(unknown.isError).toBe(true);
  });
});
