import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { NoteDocument } from "@loam/shared/notes/noteModel";
import type { PluginNoteSummary, PluginOp, PluginOps } from "@loam/shared/plugins/pluginApi";
import type { NotesStore } from "@loam/storage/NotesStore";
import { extractTabText } from "@loam/storage/search";
import { StoreError } from "@loam/storage/storeError";

const idSchema = z.string().min(1).max(512);
const blocksSchema = z.array(z.unknown()).max(10_000);

/** Each operation's params, checked before it runs. */
const OP_PARAMS: { [O in PluginOp]: z.ZodType<PluginOps[O]["params"]> } = {
  "notes.get": z.strictObject({ noteId: idSchema }),
  "notes.list": z.strictObject({}),
  "notes.search": z.strictObject({
    query: z.string().max(200),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  "notes.backlinks": z.strictObject({ noteId: idSchema }),
  "notes.create": z.strictObject({
    title: z.string().max(500),
    blocks: blocksSchema,
    folderId: idSchema.nullable().optional(),
  }),
  "notes.setTitle": z.strictObject({ noteId: idSchema, title: z.string().max(500) }),
  "notes.append": z.strictObject({ noteId: idSchema, blocks: blocksSchema }),
  "notes.trash": z.strictObject({ noteId: idSchema }),
};

const summary = (
  note: Pick<NoteDocument, "id" | "title" | "updatedAt" | "folderId" | "projectId">,
): PluginNoteSummary => ({
  id: note.id,
  title: note.title,
  updatedAt: note.updatedAt,
  folderId: note.folderId ?? null,
  projectId: note.projectId ?? null,
});

/** The first page tab, which plugins append to; a note without one gets one. */
const pageTab = (note: NoteDocument) => note.tabs.find((tab) => (tab.kind ?? "page") === "page");

const runOp = async <O extends PluginOp>(
  store: NotesStore,
  op: O,
  params: PluginOps[O]["params"],
) => {
  const external = { external: true };
  switch (op) {
    case "notes.get": {
      const { noteId } = params as PluginOps["notes.get"]["params"];
      const note = await store.getNote(noteId);
      return {
        ...summary(note),
        text: note.tabs
          .map((tab) => extractTabText(note, tab))
          .filter(Boolean)
          .join("\n"),
      };
    }
    case "notes.list":
      return (await store.getLibrary()).notes.map(summary);
    case "notes.search": {
      const { query, limit = 20 } = params as PluginOps["notes.search"]["params"];
      const response = await store.searchNotes(query, limit, 0);
      return response.results.map((result) => ({
        noteId: result.noteId,
        title: result.title,
        snippet: result.snippet.text,
      }));
    }
    case "notes.backlinks": {
      const { noteId } = params as PluginOps["notes.backlinks"]["params"];
      const backlinks = await store.getBacklinks(noteId);
      return backlinks.notes.map((note) =>
        summary({ ...note, folderId: undefined, projectId: undefined }),
      );
    }
    case "notes.create": {
      const { title, blocks, folderId } = params as PluginOps["notes.create"]["params"];
      const tabId = randomUUID();
      const note = await store.createNote(
        {
          id: randomUUID(),
          title,
          folderId,
          tabs: [{ id: tabId, title: "Notes", kind: "page" }],
          activeTabId: tabId,
          blocksByTab: { [tabId]: blocks },
        },
        external,
      );
      return summary(note);
    }
    case "notes.setTitle": {
      const { noteId, title } = params as PluginOps["notes.setTitle"]["params"];
      // Writes from outside the window name the version they change, so an edit made
      // meanwhile isn't overwritten: the plugin gets CONFLICT and can read the note again.
      const note = await store.getNote(noteId);
      const saved = await store.saveNote(noteId, { title }, note.updatedAt, external);
      return summary({ ...note, title, updatedAt: saved.updatedAt });
    }
    case "notes.append": {
      const { noteId, blocks } = params as PluginOps["notes.append"]["params"];
      const note = await store.getNote(noteId);
      const tab = pageTab(note);
      const patch = tab
        ? {
            blocksByTab: {
              ...note.blocksByTab,
              [tab.id]: [...(note.blocksByTab[tab.id] ?? []), ...blocks],
            },
          }
        : (() => {
            const tabId = randomUUID();
            return {
              tabs: [...note.tabs, { id: tabId, title: "Notes", kind: "page" as const }],
              blocksByTab: { ...note.blocksByTab, [tabId]: blocks },
            };
          })();
      const saved = await store.saveNote(noteId, patch, note.updatedAt, external);
      return summary({ ...note, updatedAt: saved.updatedAt });
    }
    case "notes.trash": {
      const { noteId } = params as PluginOps["notes.trash"]["params"];
      await store.deleteNote(noteId, external);
      return null;
    }
  }
  throw new StoreError("Unknown plugin operation.", "VALIDATION_ERROR", 400);
};

/**
 * Checks an operation's params, then runs it on the notes in `store` (asked
 * for only once the params are good). Every write is marked external, so
 * the window hears of it.
 */
export const runPluginOp = async (op: PluginOp, params: unknown, store: () => NotesStore) => {
  const parsed = OP_PARAMS[op].safeParse(params ?? {});
  if (!parsed.success) {
    const where = parsed.error.issues[0]?.path.join(".");
    throw new StoreError(`Invalid request${where ? `: ${where}` : ""}.`, "VALIDATION_ERROR", 400);
  }
  return runOp(store(), op, parsed.data);
};
