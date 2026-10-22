import { describe, expect, it } from "vitest";

import { buildNoteHref } from "../notes/noteLinks";
import type { NewNote, NoteDocument, NotesLayout } from "../notes/noteModel";
import type {
  BridgeResult,
  LoamBridgeMethod,
  LoamBridgeParams,
  LoamBridgeResult,
} from "./loamBridge";

/** The part of a bridge the suite calls: one request, answered like `window.loam.invoke`. */
type ConformanceInvoke = <M extends LoamBridgeMethod>(
  method: M,
  params: LoamBridgeParams<M>,
) => Promise<BridgeResult<LoamBridgeResult<M>>>;

type OpenHost = () => Promise<{ invoke: ConformanceInvoke; close?: () => Promise<void> }>;

/** Fixed ids, as stores require: one per note, folder and project the tests make. */
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A = uuid(1);
const B = uuid(2);
const C = uuid(3);
const FOLDER = uuid(10);
const PROJECT = uuid(20);
const MISSING = uuid(99);

const paragraph = (id: string, text: string, href?: string) => ({
  id,
  type: "paragraph",
  props: {},
  content: href
    ? [{ type: "link", href, content: [{ type: "text", text, styles: {} }] }]
    : [{ type: "text", text, styles: {} }],
  children: [],
});

const newNote = (id: string, title: string, text = "", place: Partial<NewNote> = {}): NewNote => ({
  id,
  title,
  tabs: [{ id: `${id}-page`, title: "Page", kind: "page" }],
  activeTabId: `${id}-page`,
  blocksByTab: { [`${id}-page`]: text ? [paragraph(`${id}-p`, text)] : [] },
  ...place,
});

/**
 * What the notes screens count on from whatever stores the notes. Loam runs it against its
 * own store; an app that hosts the screens over its own storage runs it against that, so a
 * Loam update that changes what the screens expect fails there instead of misbehaving.
 */
export const describeNotesHostConformance = (name: string, open: OpenHost) =>
  describe(`${name} as a notes host`, () => {
    const withHost = (test: (call: Call) => Promise<void>) => async () => {
      const { invoke, close } = await open();
      try {
        await test(callWith(invoke));
      } finally {
        await close?.();
      }
    };

    it(
      "creates a note, lists its summary and reads it in full",
      withHost(async (call) => {
        const created = await call("notes.create", { note: newNote(A, "Plan", "Wait for it") });
        expect(created).toMatchObject({ id: A, title: "Plan", contentState: "full" });

        const library = await call("notes.library", {});
        const summary = library.notes.find((note) => note.id === A);
        expect(summary).toMatchObject({ id: A, title: "Plan" });
        expect(library.folders).toEqual([]);
        expect(library.projects).toEqual([]);

        const note = await call("notes.get", { noteId: A });
        expect(note.tabs).toEqual([
          expect.objectContaining({ id: `${A}-page`, title: "Page", kind: "page" }),
        ]);
        expect(textOf(note)).toBe("Wait for it");
      }),
    );

    it(
      "saves only the fields a patch names, and keeps the version when nothing changed",
      withHost(async (call) => {
        const created = await call("notes.create", { note: newNote(A, "Plan", "Body") });

        const renamed = await call("notes.save", {
          noteId: A,
          patch: { title: "Renamed" },
          baseUpdatedAt: created.updatedAt,
        });
        expect(renamed.conflict).toBeUndefined();
        const afterRename = await call("notes.get", { noteId: A });
        expect(afterRename.title).toBe("Renamed");
        expect(textOf(afterRename)).toBe("Body");

        await call("notes.save", {
          noteId: A,
          patch: { blocksByTab: { [`${A}-page`]: [paragraph(`${A}-p`, "New body")] } },
          baseUpdatedAt: renamed.updatedAt,
        });
        const afterBody = await call("notes.get", { noteId: A });
        expect(afterBody.title).toBe("Renamed");
        expect(textOf(afterBody)).toBe("New body");

        const again = await call("notes.save", {
          noteId: A,
          patch: { title: "Renamed" },
          baseUpdatedAt: afterBody.updatedAt,
        });
        expect(again.updatedAt).toBe(afterBody.updatedAt);
      }),
    );

    it(
      "keeps projects, folders, sub-notes and their order from a layout save",
      withHost(async (call) => {
        for (const [id, title] of [
          [A, "First"],
          [B, "Second"],
          [C, "Inside first"],
        ] as const)
          await call("notes.create", { note: newNote(id, title) });

        const layout: NotesLayout = {
          projects: [{ id: PROJECT, name: "Research" }],
          folders: [{ id: FOLDER, name: "Setups", projectId: PROJECT }],
          notes: [
            { id: B, folderId: FOLDER },
            { id: A, folderId: null, projectId: PROJECT },
            { id: C, folderId: null, parentNoteId: A },
          ],
        };
        const saved = await call("notes.saveLayout", { layout });
        const library = await call("notes.library", {});
        for (const bootstrap of [saved, library]) {
          expect(bootstrap.projects.map((project) => [project.id, project.name])).toEqual([
            [PROJECT, "Research"],
          ]);
          expect(bootstrap.folders).toEqual([
            expect.objectContaining({ id: FOLDER, name: "Setups", projectId: PROJECT }),
          ]);
          const place = (id: string) => {
            const note = bootstrap.notes.find((candidate) => candidate.id === id);
            return [note?.folderId, note?.projectId, note?.parentNoteId];
          };
          expect(place(B)).toEqual([FOLDER, undefined, undefined]);
          expect(place(A)).toEqual([undefined, PROJECT, undefined]);
          expect(place(C)).toEqual([undefined, undefined, A]);
        }
      }),
    );

    it(
      "moves a deleted note to the trash, keeps its sub-notes, and puts it back",
      withHost(async (call) => {
        await call("notes.create", { note: newNote(A, "Parent", "Keep me") });
        await call("notes.create", { note: newNote(C, "Child", "", { parentNoteId: A }) });

        const deleted = await call("notes.delete", { noteId: A });
        expect(deleted.id).toBe(A);
        const library = await call("notes.library", {});
        expect(library.notes.map((note) => note.id)).toEqual([C]);
        expect(library.notes[0]?.parentNoteId).toBeUndefined();
        expect(await call("notes.trash", {})).toEqual([
          expect.objectContaining({ id: A, title: "Parent" }),
        ]);

        const restored = await call("notes.restoreTrash", { noteId: A });
        expect(restored.id).toBe(A);
        expect(textOf(await call("notes.get", { noteId: A }))).toBe("Keep me");
        expect(await call("notes.trash", {})).toEqual([]);
      }),
    );

    it(
      "empties a trashed note for good",
      withHost(async (call) => {
        await call("notes.create", { note: newNote(A, "Gone") });
        await call("notes.delete", { noteId: A });
        await call("notes.deleteForever", { noteId: A });
        expect(await call("notes.trash", {})).toEqual([]);
        expect((await call("notes.library", {})).notes).toEqual([]);
      }),
    );

    it(
      "puts back a note deleted a moment ago, as undo does",
      withHost(async (call) => {
        await call("notes.create", { note: newNote(A, "Oops", "Still here") });
        const deleted = await call("notes.delete", { noteId: A });
        await call("notes.restore", { note: deleted });
        expect(textOf(await call("notes.get", { noteId: A }))).toBe("Still here");
      }),
    );

    it(
      "finds the notes that link a note",
      withHost(async (call) => {
        await call("notes.create", { note: newNote(A, "Target") });
        await call("notes.create", {
          note: {
            ...newNote(B, "Source"),
            blocksByTab: { [`${B}-page`]: [paragraph(`${B}-p`, "see target", buildNoteHref(A))] },
          },
        });
        const backlinks = await call("notes.backlinks", { noteId: A });
        expect(backlinks.noteCount).toBe(1);
        expect(backlinks.notes).toEqual([expect.objectContaining({ id: B, title: "Source" })]);
      }),
    );

    it(
      "searches titles and bodies, with the matched text in the snippet",
      withHost(async (call) => {
        await call("notes.create", { note: newNote(A, "Opening range", "wait for the break") });
        await call("notes.create", { note: newNote(B, "Other", "nothing here") });
        const found = await call("notes.search", { query: "break", limit: 20 });
        expect(found.results.map((result) => result.noteId)).toEqual([A]);
        const [{ snippet }] = found.results as [(typeof found.results)[number]];
        expect(
          snippet.text.slice(snippet.matchStart, snippet.matchStart + snippet.matchLength),
        ).toBe("break");
      }),
    );

    it(
      "answers NOT_FOUND for a note it doesn't have",
      withHost(async (call) => {
        await expect(call("notes.get", { noteId: MISSING })).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
      }),
    );
  });

type Call = <M extends LoamBridgeMethod>(
  method: M,
  params: LoamBridgeParams<M>,
) => Promise<LoamBridgeResult<M>>;

const callWith =
  (invoke: ConformanceInvoke): Call =>
  async (method, params) => {
    const result = await invoke(method, params);
    if (!result.ok) throw Object.assign(new Error(result.error.message), result.error);
    return result.data;
  };

/** The plain text of a note's first page. */
const textOf = (note: NoteDocument) =>
  ((note.blocksByTab[note.tabs[0]!.id] ?? []) as { content?: unknown }[])
    .flatMap((block) => (Array.isArray(block.content) ? block.content : []))
    .map(function text(node: { text?: string; content?: unknown }): string {
      if (typeof node.text === "string") return node.text;
      return Array.isArray(node.content) ? node.content.map(text).join("") : "";
    })
    .join("");
