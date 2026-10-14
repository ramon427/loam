import { describe, expect, it, vi } from "vitest";

import { tabKindOf, type NoteTab, type NotesBootstrap } from "@loam/shared/notes/noteModel";

import { createMemoryStorageAdapter } from "../adapters/memoryAdapter";
import type { StorageCollection } from "../adapter";
import {
  bodyPatch,
  createNote,
  createTestStore,
  folderId,
  newNote,
  noteId,
  noteLink,
  paragraph,
  projectId,
  text,
} from "../testing/storeFixtures";

const A = noteId(1);
const B = noteId(2);
const C = noteId(3);
const D = noteId(4);

const link = (href: string, label: string) => ({
  type: "link" as const,
  href,
  content: [text(label)],
});
const F = folderId(1);
const G = folderId(2);
const P = projectId(1);
const Q = projectId(2);

const rejection = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("Expected the store to reject.");
    },
    (error: unknown) => error as { code: string; status: number },
  );

const titles = async (store: Awaited<ReturnType<typeof createTestStore>>) =>
  (await store.getLibrary()).notes.map((note) => note.title);

describe("NotesStore notes", () => {
  it("creates a note and serves it as a summary and in full", async () => {
    const store = await createTestStore();
    await createNote(store, A, {
      title: "Reading list",
      blocks: [paragraph(text("Photosynthesis basics"))],
    });

    expect((await store.getLibrary()).notes).toEqual([
      expect.objectContaining({ id: A, title: "Reading list", contentState: "summary" }),
    ]);
    const note = await store.getNote(A);
    expect(note).toMatchObject({ id: A, title: "Reading list", contentState: "full" });
    expect(JSON.stringify(note.blocksByTab)).toContain("Photosynthesis basics");
  });

  it("rejects a second note with the same id and notes it can't read", async () => {
    const store = await createTestStore();
    await createNote(store, A);
    await expect(rejection(createNote(store, A))).resolves.toMatchObject({ status: 400 });
    await expect(
      rejection(store.createNote({ ...newNote(B), activeTabId: "missing" })),
    ).resolves.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(rejection(store.createNote({ ...newNote(B), tabs: [] }))).resolves.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(rejection(store.getNote(B))).resolves.toMatchObject({ status: 404 });
  });

  it("rejects graphs, tables and videos without the structure the app reads", async () => {
    const store = await createTestStore();
    await createNote(store, A);
    for (const patch of [
      { graphsByTab: { "tab-1": {} } },
      { graphsByTab: { "tab-1": { nodes: [{ id: "n1" }], edges: [] } } },
      { tablesByTab: { "tab-1": { columns: [] } } },
      { video: { url: "https://youtu.be/abc" } },
    ])
      await expect(rejection(store.saveNote(A, patch))).resolves.toMatchObject({
        code: "VALIDATION_ERROR",
      });
    await expect(
      rejection(store.createNote({ ...newNote(B), graphsByTab: { "tab-1": { nodes: [] } } })),
    ).resolves.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("opens and deletes a note stored before graphs and tables were checked", async () => {
    const adapter = createMemoryStorageAdapter();
    const store = await createTestStore(adapter);
    await createNote(store, A, { title: "Old note" });
    const stored = (await adapter.get("documents", A))?.value as Record<string, unknown>;
    await adapter.commit([
      {
        type: "put",
        collection: "documents",
        id: A,
        value: { ...stored, graphsByTab: { "tab-1": {} }, tablesByTab: { x: {} } },
      },
    ]);

    await expect(store.getNote(A)).resolves.toMatchObject({ title: "Old note" });
    await expect(store.deleteNote(A)).resolves.toMatchObject({ id: A });
  });

  it("reads a tab saved as a text tab as a page, and saves it as one", async () => {
    const adapter = createMemoryStorageAdapter();
    const store = await createTestStore(adapter);
    await createNote(store, A);
    const stored = (await adapter.get("documents", A))?.value as Record<string, unknown>;
    const legacyTabs = [{ id: "tab-1", title: "Notes", kind: "text" }];
    await adapter.commit([
      { type: "put", collection: "documents", id: A, value: { ...stored, tabs: legacyTabs } },
    ]);

    expect((await store.getNote(A)).tabs.map(tabKindOf)).toEqual(["page"]);
    await store.saveNote(A, { tabs: legacyTabs as NoteTab[] });
    expect((await store.getNote(A)).tabs.map((tab) => tab.kind)).toEqual(["page"]);
  });

  it("opens a Text tab from an older version as a graph holding its Markdown", async () => {
    const adapter = createMemoryStorageAdapter();
    const store = await createTestStore(adapter);
    await createNote(store, A);
    const stored = (await adapter.get("documents", A))?.value as Record<string, unknown>;
    const markdown = "# Plan\n\nRead about osmosis.";
    const olderNote = {
      ...stored,
      tabs: [...(stored.tabs as NoteTab[]), { id: "text", title: "Text", kind: "markdown" }],
      textsByTab: { text: markdown },
    };
    await adapter.commit([{ type: "put", collection: "documents", id: A, value: olderNote }]);

    const note = await store.getNote(A);
    expect(note.tabs.map((tab) => tab.kind)).toEqual(["page", "graph"]);
    expect(note.graphsByTab?.text?.nodes).toEqual([
      expect.objectContaining({ shape: "text", notes: markdown }),
    ]);

    // The graph is saved with the next change; the Markdown stays for older versions.
    await store.saveNote(A, { activeTabId: "text" });
    await expect(adapter.get("documents", A)).resolves.toMatchObject({
      value: {
        tabs: [{ kind: "page" }, { id: "text", kind: "graph" }],
        graphsByTab: { text: { nodes: [{ notes: markdown }] } },
        textsByTab: { text: markdown },
      },
    });
  });

  it("gives a Text tab synced or imported from an older version a graph of its Markdown", async () => {
    const store = await createTestStore();
    const tabs = [
      { id: "tab-1", title: "Notes", kind: "page" },
      { id: "text", title: "Text", kind: "markdown" },
    ];
    await store.createNote({ ...newNote(A), tabs, textsByTab: { text: "Draft" } } as never);

    const note = await store.getNote(A);
    expect(note.tabs.map(tabKindOf)).toEqual(["page", "graph"]);
    expect(note.graphsByTab?.text?.nodes).toEqual([expect.objectContaining({ notes: "Draft" })]);
  });

  it("keeps Markdown file tabs, which share the kind older Text tabs were saved with", async () => {
    const store = await createTestStore();
    const tabs = [
      { id: "tab-1", title: "Notes", kind: "page" },
      { id: "md", title: "Plan", kind: "markdown" },
    ] as NoteTab[];
    const file = { name: "plan.md", source: { kind: "imported", fileName: "plan.md" } } as const;
    await store.createNote({ ...newNote(A), tabs, filesByTab: { md: file } });

    expect((await store.getNote(A)).tabs.map(tabKindOf)).toEqual(["page", "markdown"]);

    // A save naming the tabs but not the files keeps the note's files.
    await store.saveNote(A, { tabs: [...tabs].reverse() });
    const note = await store.getNote(A);
    expect(note.tabs.map(tabKindOf)).toEqual(["markdown", "page"]);
    expect(note.filesByTab).toEqual({ md: file });
    expect(note.graphsByTab?.md).toBeUndefined();
  });

  it("drops backlinks tabs from older versions and shows the first tab left", async () => {
    const adapter = createMemoryStorageAdapter();
    const store = await createTestStore(adapter);
    await createNote(store, A);
    const stored = (await adapter.get("documents", A))?.value as Record<string, unknown>;
    const withBacklinks = {
      ...stored,
      tabs: [...(stored.tabs as NoteTab[]), { id: "links", title: "Backlinks", kind: "backlinks" }],
      activeTabId: "links",
    };
    await adapter.commit([{ type: "put", collection: "documents", id: A, value: withBacklinks }]);

    expect(await store.getNote(A)).toMatchObject({ tabs: [{ id: "tab-1" }], activeTabId: "tab-1" });
    // An older computer syncs the note back with its backlinks tab.
    await store.saveNote(A, { ...withBacklinks, title: "Renamed" });
    expect(await store.getNote(A)).toMatchObject({ tabs: [{ id: "tab-1" }], activeTabId: "tab-1" });
    await expect(adapter.get("documents", A)).resolves.toMatchObject({
      value: { tabs: [{ id: "tab-1" }], activeTabId: "tab-1" },
    });
  });

  it("keeps an empty page in place of a note's only tab when it was a backlinks tab", async () => {
    const store = await createTestStore();
    const tabs = [{ id: "links", title: "Backlinks", kind: "backlinks" }];
    await store.createNote({ ...newNote(A), tabs, activeTabId: "links" } as never);

    const note = await store.getNote(A);
    expect(note.tabs.map((tab) => [tab.id, tabKindOf(tab)])).toEqual([["links", "page"]]);
    expect(note).toMatchObject({ activeTabId: "links", blocksByTab: { links: [] } });
  });

  it("compares an external save's version within the save, so a concurrent one can't slip through", async () => {
    const store = await createTestStore(undefined, () => Date.parse("2026-10-11T10:00:00Z"));
    const note = await store.createNote(newNote(A));
    const writes = await Promise.allSettled([
      store.saveNote(note.id, { title: "First AI" }, note.updatedAt, { external: true }),
      store.saveNote(note.id, { title: "Second AI" }, note.updatedAt, { external: true }),
    ]);
    expect(writes[0]!.status).toBe("fulfilled");
    expect(writes[1]).toMatchObject({ status: "rejected", reason: { code: "CONFLICT" } });
    const current = await store.getNote(note.id);
    expect(current.title).toBe("First AI");
    expect(current.updatedAt).not.toBe(note.updatedAt);
  });

  it("saves only the fields a patch names", async () => {
    const store = await createTestStore();
    await createNote(store, A, { title: "Draft", blocks: [paragraph(text("First"))] });

    await store.saveNote(A, { title: "Renamed" });
    let note = await store.getNote(A);
    expect(note.title).toBe("Renamed");
    expect(JSON.stringify(note.blocksByTab)).toContain("First");

    await store.saveNote(A, bodyPatch(paragraph(text("Second"))));
    note = await store.getNote(A);
    expect(note.title).toBe("Renamed");
    expect(JSON.stringify(note.blocksByTab)).toContain("Second");
    await expect(store.searchNotes("second")).resolves.toMatchObject({
      results: [expect.objectContaining({ noteId: A })],
    });
  });

  it("changes nothing for an empty save", async () => {
    const store = await createTestStore();
    const created = await createNote(store, A);
    await expect(store.saveNote(A, {})).resolves.toEqual({ updatedAt: created.updatedAt });
  });

  it("keeps blocks only for tabs the note has", async () => {
    const store = await createTestStore();
    await createNote(store, A);
    await store.saveNote(A, {
      tabs: [
        { id: "tab-1", title: "Notes", kind: "page" },
        { id: "tab-2", title: "Graph", kind: "graph" },
      ],
    });
    expect(Object.keys((await store.getNote(A)).blocksByTab)).toEqual(["tab-1", "tab-2"]);
    await store.saveNote(A, {
      tabs: [{ id: "tab-2", title: "Graph", kind: "graph" }],
      activeTabId: "tab-2",
    });
    expect(Object.keys((await store.getNote(A)).blocksByTab)).toEqual(["tab-2"]);
  });

  it("deletes a note and puts it back where it was", async () => {
    const store = await createTestStore();
    for (const [id, title] of [
      [A, "One"],
      [B, "Two"],
      [C, "Three"],
    ] as const)
      await createNote(store, id, { title });

    const deleted = await store.deleteNote(B);
    expect(await titles(store)).toEqual(["One", "Three"]);
    await expect(rejection(store.saveNote(B, { title: "x" }))).resolves.toMatchObject({
      status: 404,
    });

    await store.restoreNote(deleted);
    expect(await titles(store)).toEqual(["One", "Two", "Three"]);
    expect((await store.getNoteHistory(B)).versions).toHaveLength(1);
  });

  it("serializes overlapping calls so each sees the previous write", async () => {
    const store = await createTestStore();
    await Promise.all(
      Array.from({ length: 5 }, (_, index) => createNote(store, noteId(index + 1))),
    );
    expect((await store.getLibrary()).notes.map((note) => note.position)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("NotesStore layout", () => {
  it("creates notes at the end of their folder", async () => {
    const store = await createTestStore();
    await store.saveLayout({ folders: [{ id: F, name: "Projects" }], notes: [] });
    await createNote(store, A, { folderId: F });
    await createNote(store, B, { folderId: F });
    await createNote(store, C);
    const notes = (await store.getLibrary()).notes;
    expect(notes.map(({ id, folderId, position }) => [id, folderId ?? null, position])).toEqual([
      [C, null, 0],
      [A, F, 0],
      [B, F, 1],
    ]);
    await expect(
      rejection(createNote(store, noteId(9), { folderId: folderId(9) })),
    ).resolves.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("moves and orders notes, and moves notes out of a removed folder", async () => {
    const store = await createTestStore();
    await createNote(store, A, { title: "One" });
    await createNote(store, B, { title: "Two" });
    await store.saveLayout({
      folders: [{ id: F, name: " Projects " }],
      notes: [
        { id: B, folderId: null },
        { id: A, folderId: F },
      ],
    });
    let library = await store.getLibrary();
    expect(library.folders).toEqual([{ id: F, name: "Projects", position: 0 }]);
    expect(library.notes.find((note) => note.id === A)?.folderId).toBe(F);
    // A note's own reads report where it is now.
    expect((await store.getNote(A)).folderId).toBe(F);

    library = await store.saveLayout({ folders: [], notes: [] });
    expect(library.notes.map((note) => [note.id, note.folderId ?? null])).toEqual([
      [B, null],
      [A, null],
    ]);
  });

  it("rejects folders that share an id and placements in unknown folders", async () => {
    const store = await createTestStore();
    await createNote(store, A);
    const folder = { id: F, name: "Projects" };
    await expect(
      rejection(store.saveLayout({ folders: [folder, folder], notes: [] })),
    ).resolves.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      rejection(store.saveLayout({ folders: [], notes: [{ id: A, folderId: F }] })),
    ).resolves.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("NotesStore projects", () => {
  /** Each note's id, folder, project and position, in library order. */
  const placements = (library: NotesBootstrap) =>
    library.notes.map(({ id, folderId, projectId, position }) => [
      id,
      folderId ?? null,
      projectId ?? null,
      position,
    ]);

  it("saves projects in order with trimmed names and only icons it can draw, and keeps them when left out", async () => {
    const store = await createTestStore();
    const rocket = { kind: "symbol", value: "rocket", color: "blue" } as const;
    let library = await store.saveLayout({
      projects: [
        { id: P, name: " Work ", icon: rocket },
        { id: Q, name: "Home", icon: { kind: "symbol", value: "<script>" } },
      ],
      folders: [],
      notes: [],
    });
    expect(library.projects).toEqual([
      { id: P, name: "Work", position: 0, icon: rocket },
      { id: Q, name: "Home", position: 1 },
    ]);
    library = await store.saveLayout({
      projects: [
        { id: Q, name: "House", icon: { kind: "emoji", value: "🏠" } },
        { id: P, name: "Work", icon: { kind: "emoji", value: "not an emoji" } },
      ],
      folders: [],
      notes: [],
    });
    expect(library.projects).toEqual([
      { id: Q, name: "House", position: 0, icon: { kind: "emoji", value: "🏠" } },
      { id: P, name: "Work", position: 1 },
    ]);
    await store.saveLayout({ folders: [], notes: [] });
    expect((await store.getLibrary()).projects).toEqual(library.projects);
  });

  it("files folders and notes into projects, and keeps them there when a layout leaves the project out", async () => {
    const store = await createTestStore();
    await createNote(store, A);
    await createNote(store, B);
    await createNote(store, C);
    await store.saveLayout({
      projects: [{ id: P, name: "Work" }],
      folders: [
        { id: F, name: "Plans", projectId: P },
        { id: G, name: "Loose" },
      ],
      notes: [
        { id: A, folderId: F },
        // A folder decides its notes' project.
        { id: B, folderId: G, projectId: P },
        { id: C, folderId: null, projectId: P },
      ],
    });
    let library = await store.getLibrary();
    expect(library.folders).toEqual([
      { id: F, name: "Plans", position: 0, projectId: P },
      { id: G, name: "Loose", position: 1 },
    ]);
    const filed = [
      [C, null, P, 0],
      [A, F, null, 0],
      [B, G, null, 0],
    ];
    expect(placements(library)).toEqual(filed);
    expect((await store.getNote(C)).projectId).toBe(P);

    library = await store.saveLayout({
      folders: library.folders.map(({ id, name }) => ({ id, name })),
      notes: library.notes.map(({ id, folderId }) => ({ id, folderId: folderId ?? null })),
    });
    expect(library.folders[0]?.projectId).toBe(P);
    expect(placements(library)).toEqual(filed);

    library = await store.saveLayout({
      folders: [{ id: F, name: "Plans", projectId: null }],
      notes: [{ id: C, folderId: null, projectId: null }],
    });
    expect(library.folders).toEqual([{ id: F, name: "Plans", position: 0 }]);
    // B's folder is gone, so it follows the listed note at the top level.
    expect(placements(library)).toEqual([
      [C, null, null, 0],
      [B, null, null, 1],
      [A, F, null, 0],
    ]);
  });

  it("moves a removed project's folders and notes to the library's top level", async () => {
    const store = await createTestStore();
    await createNote(store, A);
    await createNote(store, B);
    await createNote(store, C);
    await store.saveLayout({
      projects: [{ id: P, name: "Work" }],
      folders: [{ id: F, name: "Plans", projectId: P }],
      notes: [
        { id: C, folderId: null },
        { id: A, folderId: F },
        { id: B, folderId: null, projectId: P },
      ],
    });
    const library = await store.saveLayout({
      projects: [],
      folders: [{ id: F, name: "Plans" }],
      notes: [],
    });
    expect(library.projects).toEqual([]);
    expect(library.folders).toEqual([{ id: F, name: "Plans", position: 0 }]);
    expect(placements(library)).toEqual([
      [C, null, null, 0],
      [B, null, null, 1],
      [A, F, null, 0],
    ]);
  });

  it("moves notes of a removed folder to the top level of its project", async () => {
    const store = await createTestStore();
    await createNote(store, A);
    await createNote(store, B);
    await store.saveLayout({
      projects: [{ id: P, name: "Work" }],
      folders: [{ id: F, name: "Plans", projectId: P }],
      notes: [
        { id: B, folderId: null, projectId: P },
        { id: A, folderId: F },
      ],
    });
    expect(placements(await store.saveLayout({ folders: [], notes: [] }))).toEqual([
      [B, null, P, 0],
      [A, null, P, 1],
    ]);
  });

  it("rejects projects that share an id, and folders or notes in unknown projects", async () => {
    const store = await createTestStore();
    await createNote(store, A);
    const project = { id: P, name: "Work" };
    for (const layout of [
      { projects: [project, project], folders: [], notes: [] },
      { projects: {}, folders: [], notes: [] },
      { folders: [{ id: F, name: "Plans", projectId: Q }], notes: [] },
      { folders: [], notes: [{ id: A, folderId: null, projectId: Q }] },
    ])
      await expect(rejection(store.saveLayout(layout))).resolves.toMatchObject({
        code: "VALIDATION_ERROR",
      });
  });

  it("creates notes at the end of their project's top level", async () => {
    const store = await createTestStore();
    await store.saveLayout({
      projects: [{ id: P, name: "Work" }],
      folders: [{ id: F, name: "Plans", projectId: P }],
      notes: [],
    });
    await createNote(store, A, { projectId: P });
    await createNote(store, B);
    await createNote(store, C, { projectId: P });
    // In a folder, the folder's project applies.
    expect((await createNote(store, D, { folderId: F, projectId: P })).projectId).toBeUndefined();
    expect(placements(await store.getLibrary())).toEqual([
      [B, null, null, 0],
      [A, null, P, 0],
      [C, null, P, 1],
      [D, F, null, 0],
    ]);
    expect(
      (await store.searchNotes("Body")).results.find((result) => result.noteId === A),
    ).toMatchObject({ projectId: P });
    await expect(rejection(createNote(store, noteId(9), { projectId: Q }))).resolves.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("shows folders and notes of a project another device deleted at the top level", async () => {
    const adapter = createMemoryStorageAdapter();
    const store = await createTestStore(adapter);
    await createNote(store, A);
    await createNote(store, B);
    const row = (await adapter.get("notes", A))!.value as Record<string, unknown>;
    // As another device's sync left them after deleting project Q.
    await adapter.commit([
      { type: "put", collection: "notes", id: B, value: { ...row, id: B, projectId: Q } },
      {
        type: "put",
        collection: "library",
        id: "folders",
        value: { folders: [{ id: F, name: "Plans", position: 0, projectId: Q }] },
      },
    ]);
    const library = await (await createTestStore(adapter)).getLibrary();
    expect(library.folders).toEqual([{ id: F, name: "Plans", position: 0 }]);
    expect(library.notes.map((note) => note.projectId)).toEqual([undefined, undefined]);
  });
});

describe("NotesStore reads", () => {
  it("finds notes that link to a note", async () => {
    const store = await createTestStore();
    await createNote(store, A, { title: "Target" });
    await createNote(store, B, {
      title: "Source",
      blocks: [paragraph(text("See "), noteLink(A, "Target"))],
    });

    await expect(store.getBacklinks(A)).resolves.toEqual({
      notes: [{ id: B, title: "Source", updatedAt: expect.any(String) }],
      noteCount: 1,
    });
    await expect(store.getBacklinks(B)).resolves.toEqual({ notes: [], noteCount: 0 });
    await store.saveNote(B, bodyPatch(paragraph(text("No link now"))));
    await expect(store.getBacklinks(A)).resolves.toEqual({ notes: [], noteCount: 0 });
  });

  it("counts links in tables and nested blocks, not text that looks like one", async () => {
    const store = await createTestStore();
    await createNote(store, A, { title: "Target" });
    const tableLink = noteLink(A, "Target");
    await createNote(store, B, {
      title: "Table",
      blocks: [
        {
          ...paragraph(),
          type: "table",
          content: {
            type: "tableContent",
            rows: [{ cells: [{ type: "tableCell", content: [tableLink] }] }],
          },
        },
      ],
    });
    await createNote(store, C, {
      title: "Nested",
      blocks: [
        {
          ...paragraph(text("Parent")),
          children: [paragraph(link(`loam-app://app/notes?noteId=${A}`, "Target"))],
        },
      ],
    });
    await createNote(store, D, {
      title: "Lookalikes",
      blocks: [
        { ...paragraph(text(`/notes?noteId=${A}`)), type: "codeBlock" },
        paragraph(link(`https://example.com/notes?noteId=${A}`, "Web")),
      ],
    });

    const backlinks = await store.getBacklinks(A);
    expect(backlinks.notes.map((note) => note.title).sort()).toEqual(["Nested", "Table"]);
  });

  it("searches titles and text without an adapter index", async () => {
    const store = await createTestStore();
    await createNote(store, A, {
      title: "Biology",
      blocks: [paragraph(text("Mitochondria make energy. Mitochondria have DNA."))],
    });
    await createNote(store, B, { title: "Chemistry", blocks: [paragraph(text("Bonds"))] });

    const response = await store.searchNotes("mitochondria");
    expect(response.hasMore).toBe(false);
    expect(response.results).toEqual([
      expect.objectContaining({ noteId: A, title: "Biology", matchCount: 2 }),
    ]);
    const { text: snippet, matchStart, matchLength } = response.results[0]!.snippet;
    expect(snippet.slice(matchStart, matchStart + matchLength)).toBe("Mitochondria");
    await expect(store.searchNotes("   ")).resolves.toEqual({ results: [], hasMore: false });
  });

  it("finds and highlights a word whatever its accents", async () => {
    const store = await createTestStore();
    await createNote(store, A, {
      title: "Trip",
      blocks: [paragraph(text("Met at the Café, then a second cafe\u0301 later."))],
    });

    const [result] = (await store.searchNotes("cafe")).results;
    expect(result).toMatchObject({ noteId: A, matchCount: 2 });
    const { text: snippet, matchStart, matchLength } = result!.snippet;
    expect(snippet.slice(matchStart, matchStart + matchLength)).toBe("Café");

    // An accented query finds plain text too.
    await createNote(store, B, { title: "Menu", blocks: [paragraph(text("Cafe opens at nine."))] });
    const menu = (await store.searchNotes("café")).results.find((hit) => hit.noteId === B);
    expect(menu).toMatchObject({ matchCount: 1 });
    expect(menu!.snippet.text.slice(menu!.snippet.matchStart, menu!.snippet.matchStart + 4)).toBe(
      "Cafe",
    );
  });
});

describe("NotesStore upgrade", () => {
  /** Records as the store wrote them before storage version 2. */
  const legacyNote = (id: string, title: string, body: string) => ({
    kind: "notes",
    noteId: id,
    surfaceId: `notes:${id}`,
    title,
    activeTabId: "tab-1",
    tabs: [
      {
        id: "tab-1",
        title: "Notes",
        kind: "text",
        blocks: [paragraph(text(body))],
      },
    ],
    blocksByTab: { "tab-1": [paragraph(text(body))] },
    isPersisted: true,
    updatedAt: 1,
  });
  const legacyRow = (id: string, title: string) => ({
    id,
    title,
    text: "",
    folderId: null,
    position: 0,
    updatedAt: "2026-10-01T00:00:00.000Z",
    activeTabId: "tab-1",
    video: null,
    linkedNoteIds: [],
  });

  it("converts notes and history from the old format and drops what only it read", async () => {
    const adapter = createMemoryStorageAdapter();
    const put = (collection: string, id: string, value: unknown) =>
      adapter.commit([{ type: "put", collection: collection as StorageCollection, id, value }]);
    await put("notes", A, legacyRow(A, "Kept"));
    await put("documents", `note:${A}`, {
      payload: legacyNote(A, "Kept", "Old body"),
      deletedAt: null,
    });
    await put("notes", B, legacyRow(B, "Deleted"));
    await put("documents", `note:${B}`, { payload: legacyNote(B, "Deleted", "x"), deletedAt: 5 });
    await put("documents", "notes-library:local", { payload: { kind: "notes-library" } });
    await put("receipts", "r1", {});
    await put("tombstones", `note:${C}`, {});
    await put("meta", "version:notes.bootstrap:local", { version: "v" });
    await put("revisions", "rev-1", {
      noteId: A,
      savedAt: 1,
      document: legacyNote(A, "Kept", "Older body"),
    });

    const store = await createTestStore(adapter);
    expect(await titles(store)).toEqual(["Kept"]);
    expect(JSON.stringify((await store.getNote(A)).blocksByTab)).toContain("Old body");
    expect((await store.getNoteVersion(A, "rev-1")).note).toMatchObject({ title: "Kept" });
    const records = await store.readAllRecords();
    expect(records.documents.map((record) => record.id)).toEqual([A]);
    expect(records.meta.map((record) => record.id)).toEqual(["schema"]);
    for (const legacy of ["receipts", "tombstones"])
      expect(await adapter.list(legacy as StorageCollection)).toEqual([]);

    // Opening again changes nothing.
    await createTestStore(adapter);
    expect((await store.readAllRecords()).documents).toHaveLength(1);
  });

  it("gives back the old format's space once, after upgrading", async () => {
    const compact = vi.fn(async () => undefined);
    const adapter = { ...createMemoryStorageAdapter(), compact };
    await adapter.commit([
      { type: "put", collection: "documents", id: `note:${A}`, value: { payload: null } },
    ]);
    await createTestStore(adapter);
    await createTestStore(adapter);
    expect(compact).toHaveBeenCalledTimes(1);
  });
});
