import { z } from "zod";

import type { AiToolAccess } from "@loam/shared/ai/aiChat";
import type {
  LoamBridgeMethod,
  LoamBridgeParams,
  LoamBridgeResult,
} from "@loam/shared/bridge/loamBridge";
import {
  tabKindOf,
  type NoteContent,
  type NoteDocument,
  type NotesBootstrap,
  type NotesLayout,
} from "@loam/shared/notes/noteModel";
import { StoreError } from "@loam/storage/storeError";
import { renderBlocks } from "@loam/transfer/markdown/blocksToMarkdown";
import { buildNoteGraphMermaid } from "@loam/transfer/markdown/noteGraphMermaid";
import { buildNoteTableMarkdown } from "@loam/transfer/markdown/noteTableMarkdown";

import type { WorkspaceRequests } from "../workspaceRequests";
import type { Dispatch } from "../requests/dispatch";
import { uuidSchema } from "../requests/params";
import type { ToolDefinition } from "../mcp/tools";

/**
 * How to put back what one change did. Kept in the chat, so a change can be
 * undone after the app restarts.
 */
export type UndoRecord =
  | { kind: "note-content"; noteId: string; before: NoteContent }
  | { kind: "note-created"; noteId: string }
  | { kind: "note-deleted"; note: NoteDocument }
  | { kind: "layout"; before: NotesLayout };

/** A tool the side chat's assistant can call. */
export type ChatTool = {
  name: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  access: AiToolAccess;
  /** What the chat shows for a call: "Edited Weekly review". */
  describe: (input: Record<string, unknown>) => Promise<{ label: string; noteId: string | null }>;
  /** What would change, shown before the user approves it. */
  preview?: (input: Record<string, unknown>) => Promise<string | null>;
  /** Runs the call and returns its result, and how to undo it when it changed something. */
  run: (input: Record<string, unknown>) => Promise<{ result: unknown; undo: UndoRecord | null }>;
};

/** How each shared AI tool is classed; tools not listed stay out of the side chat. */
const SHARED_TOOLS: Record<string, AiToolAccess> = {
  loam_notes_library: "read",
  loam_notes_search: "read",
  loam_notes_backlinks: "read",
  loam_notes_history: "read",
  loam_notes_version: "read",
  loam_notes_trash: "read",
  loam_graphs_templates: "read",
  loam_workspace_status: "read",
  // Opening a note only changes what the window shows.
  loam_workspace_open: "read",
  loam_notes_get: "read",
  loam_notes_save: "edit",
  loam_blocks_set: "edit",
  loam_graphs_set: "edit",
  loam_tables_set: "edit",
  loam_embeds_set: "edit",
  loam_video_set: "edit",
  loam_tabs_add: "edit",
  loam_tabs_remove: "edit",
  loam_graphs_layout: "edit",
  loam_graphs_import: "edit",
  loam_notes_restore_version: "edit",
  loam_notes_new: "organize",
  loam_notes_create: "organize",
  loam_notes_delete: "organize",
  loam_notes_restore: "organize",
  loam_notes_restore_trash: "organize",
  loam_notes_move: "organize",
  loam_notes_save_layout: "organize",
  loam_projects_create: "organize",
  loam_projects_update: "organize",
  loam_projects_move: "organize",
  loam_projects_delete: "organize",
  loam_folders_create: "organize",
  loam_folders_move: "organize",
  loam_folders_rename: "organize",
  loam_folders_delete: "organize",
};

/** Tools that change one existing note's content; undone by restoring that content. */
const NOTE_EDIT_TOOLS = new Set(
  Object.entries(SHARED_TOOLS)
    .filter(([, access]) => access === "edit")
    .map(([name]) => name),
);
/** Tools that change folders, projects or where notes are; undone by restoring the layout. */
const LAYOUT_TOOLS = new Set([
  "loam_notes_move",
  "loam_notes_save_layout",
  "loam_projects_create",
  "loam_projects_update",
  "loam_projects_move",
  "loam_projects_delete",
  "loam_folders_create",
  "loam_folders_move",
  "loam_folders_rename",
  "loam_folders_delete",
]);
const CREATE_TOOLS = new Set([
  "loam_notes_new",
  "loam_notes_create",
  "loam_notes_restore",
  "loam_notes_restore_trash",
]);

const VERBS: Record<string, string> = {
  loam_notes_library: "Looked through the library",
  loam_notes_search: "Searched",
  loam_notes_backlinks: "Found links to",
  loam_notes_history: "Looked at the history of",
  loam_notes_version: "Read an earlier version of",
  loam_notes_trash: "Looked in Trash",
  loam_graphs_templates: "Looked at diagram templates",
  loam_workspace_status: "Checked the open note",
  loam_workspace_open: "Opened",
  loam_notes_get: "Read",
  loam_notes_read: "Read",
  loam_notes_write: "Edited",
  loam_notes_save: "Edited",
  loam_blocks_set: "Edited",
  loam_graphs_set: "Edited a diagram in",
  loam_tables_set: "Edited a table in",
  loam_embeds_set: "Edited an embed in",
  loam_video_set: "Changed the video of",
  loam_tabs_add: "Added a tab to",
  loam_tabs_remove: "Removed a tab from",
  loam_graphs_layout: "Arranged a diagram in",
  loam_graphs_import: "Replaced a diagram in",
  loam_notes_restore_version: "Restored an earlier version of",
  loam_notes_new: "Created",
  loam_notes_create: "Created",
  loam_notes_delete: "Deleted",
  loam_notes_restore: "Restored",
  loam_notes_restore_trash: "Restored",
  loam_notes_move: "Moved",
  loam_notes_save_layout: "Reorganized the library",
  loam_projects_create: "Created project",
  loam_projects_update: "Changed project",
  loam_projects_move: "Reordered projects",
  loam_projects_delete: "Removed project",
  loam_folders_create: "Created folder",
  loam_folders_move: "Moved folder",
  loam_folders_rename: "Renamed folder",
  loam_folders_delete: "Removed folder",
};

const MAX_PREVIEW_LINES = 400;

/** Content fields a note-content undo writes back; anything else stays as it is. */
const contentOf = (note: NoteDocument): NoteContent => ({
  title: note.title,
  tabs: note.tabs,
  blocksByTab: note.blocksByTab,
  activeTabId: note.activeTabId,
  ...(note.video ? { video: note.video } : {}),
  ...(note.graphsByTab ? { graphsByTab: note.graphsByTab } : {}),
  ...(note.tablesByTab ? { tablesByTab: note.tablesByTab } : {}),
  ...(note.embedsByTab ? { embedsByTab: note.embedsByTab } : {}),
  ...(note.textsByTab ? { textsByTab: note.textsByTab } : {}),
});

const layoutOf = (library: NotesBootstrap): NotesLayout => ({
  projects: library.projects.map(({ id, name, icon }) => ({ id, name, ...(icon ? { icon } : {}) })),
  folders: library.folders.map(({ id, name, projectId }) => ({
    id,
    name,
    projectId: projectId ?? null,
  })),
  notes: library.notes.map(({ id, folderId, projectId }) => ({
    id,
    folderId: folderId ?? null,
    projectId: projectId ?? null,
  })),
});

/**
 * A note as Markdown, tab by tab, which models read far more easily than the
 * editor's block JSON. Links to notes keep the app's own hrefs.
 */
const noteMarkdown = (note: NoteDocument, titles: Map<string, string>) => {
  const context = {
    keepAppLinks: true,
    noteTarget: (noteId: string) => {
      const title = titles.get(noteId);
      return title === undefined ? null : { target: noteId, title };
    },
    videoUrlAt: () => null,
    imagePath: (reference: string) => reference,
  };
  return note.tabs.map((tab) => {
    const kind = tabKindOf(tab);
    let markdown = "";
    if (kind === "page") markdown = renderBlocks(note.blocksByTab[tab.id], context);
    if (kind === "table" || kind === "board") {
      const table = note.tablesByTab?.[tab.id];
      markdown = table ? buildNoteTableMarkdown(table) : "";
    }
    if (kind === "graph") {
      const graph = note.graphsByTab?.[tab.id];
      markdown = graph?.nodes.length
        ? `\`\`\`mermaid\n${buildNoteGraphMermaid(graph)}\n\`\`\``
        : "";
    }
    if (kind === "embed") markdown = note.embedsByTab?.[tab.id]?.url ?? "";
    const file = note.filesByTab?.[tab.id];
    if (file) markdown = file.source.kind === "text" ? file.source.text : `File: ${file.name}`;
    return { id: tab.id, title: tab.title, kind, markdown };
  });
};

/** A line diff of two texts, enough to show what an edit changes. */
export const lineDiff = (before: string, after: string) => {
  const a = before.split("\n");
  const b = after.split("\n");
  // Longest common subsequence over lines; notes are small enough for this.
  if (a.length * b.length > 4_000_000) return `- (${a.length} lines)\n+ (${b.length} lines)`;
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i]![j] =
        a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const lines: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push(`  ${a[i]}`);
      i++;
      j++;
    } else if (i < a.length && (j === b.length || table[i + 1]![j]! >= table[i]![j + 1]!)) {
      // Removed lines come before the lines that replace them.
      lines.push(`- ${a[i]}`);
      i++;
    } else {
      lines.push(`+ ${b[j]}`);
      j++;
    }
  }
  // Only the changes and a little around them.
  const keep = new Set<number>();
  lines.forEach((line, index) => {
    if (line.startsWith("  ")) return;
    for (let k = Math.max(0, index - 2); k <= Math.min(lines.length - 1, index + 2); k++)
      keep.add(k);
  });
  const shown: string[] = [];
  let previous = -1;
  for (const index of [...keep].sort((x, y) => x - y)) {
    if (previous !== -1 && index > previous + 1) shown.push("  …");
    shown.push(lines[index]!);
    previous = index;
  }
  return shown.length > MAX_PREVIEW_LINES
    ? [
        ...shown.slice(0, MAX_PREVIEW_LINES),
        `  … ${shown.length - MAX_PREVIEW_LINES} more lines`,
      ].join("\n")
    : shown.join("\n") || "No visible change.";
};

const asString = (value: unknown) => (typeof value === "string" ? value : null);

/**
 * The side chat's tools: the shared AI tools it may use, each classed for
 * the access modes and recording how to undo it, Markdown tools for reading
 * and writing pages, and the `extra` tools for the web.
 */
export const createChatTools = ({
  dispatch,
  workspace,
  tools,
  extra = [],
}: {
  dispatch: Dispatch;
  workspace: Pick<WorkspaceRequests, "request" | "flush">;
  tools: () => readonly ToolDefinition[];
  /** Tools beyond the notes: the web and the browser. */
  extra?: ChatTool[];
}) => {
  const call = async <M extends LoamBridgeMethod>(
    method: M,
    params: LoamBridgeParams<M>,
  ): Promise<LoamBridgeResult<M>> => {
    const result = await dispatch(method, params, "ai");
    if (!result.ok)
      throw new StoreError(result.error.message, result.error.code, result.error.status);
    return result.data;
  };
  const shared = (name: string) => {
    const tool = tools().find((entry) => entry.name === name);
    if (!tool) throw new Error(`${name} is not a tool.`);
    return tool;
  };
  const library = () => call("notes.library", {});
  const fullNote = async (noteId: string) => {
    await workspace.flush();
    return call("notes.get", { noteId });
  };
  const titleOf = async (noteId: string | null) => {
    if (!noteId) return null;
    const note = (await library()).notes.find((entry) => entry.id === noteId);
    return note ? note.title || "Untitled" : null;
  };
  const describeWith =
    (name: string) =>
    async (input: Record<string, unknown>): Promise<{ label: string; noteId: string | null }> => {
      const verb = VERBS[name] ?? name;
      const noteId = asString(input.noteId);
      if (name === "loam_notes_search")
        return { label: `${verb} for "${asString(input.query) ?? ""}"`, noteId: null };
      const named = asString(input.name) ?? asString(input.title);
      if (noteId) {
        const title = (await titleOf(noteId).catch(() => null)) ?? "a note";
        return { label: `${verb} ${title}`, noteId };
      }
      if (name === "loam_notes_create") {
        const note = input.note as { title?: unknown; id?: unknown } | undefined;
        return { label: `${verb} ${asString(note?.title) ?? "a note"}`, noteId: null };
      }
      if (name === "loam_notes_restore") {
        const note = input.note as { title?: unknown; id?: unknown } | undefined;
        return {
          label: `${verb} ${asString(note?.title) ?? "a note"}`,
          noteId: asString(note?.id),
        };
      }
      return { label: named ? `${verb} ${named}` : verb, noteId: null };
    };

  const markdownPreview = async (
    noteId: string,
    apply: (note: NoteDocument) => Promise<NoteDocument>,
  ) => {
    const { notes } = await library();
    const titles = new Map(notes.map((note) => [note.id, note.title]));
    const before = await fullNote(noteId);
    const after = await apply(before);
    const render = (note: NoteDocument) =>
      [
        `# ${note.title}`,
        ...noteMarkdown(note, titles).map((tab) => `## ${tab.title}\n${tab.markdown}`),
      ].join("\n\n");
    return lineDiff(render(before), render(after));
  };

  const fromShared = (name: string, access: AiToolAccess): ChatTool => {
    const tool = shared(name);
    return {
      name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      access,
      describe: describeWith(name),
      preview:
        access === "edit" && (name === "loam_notes_save" || name === "loam_blocks_set")
          ? async (input) => {
              const noteId = asString(input.noteId);
              if (!noteId) return null;
              return markdownPreview(noteId, async (note) =>
                name === "loam_notes_save"
                  ? { ...note, ...(input.patch as Partial<NoteDocument>) }
                  : {
                      ...note,
                      blocksByTab: {
                        ...note.blocksByTab,
                        [String(input.tabId)]: input.blocks as unknown[],
                      },
                    },
              );
            }
          : undefined,
      async run(input) {
        const noteId = asString(input.noteId);
        let undo: UndoRecord | null = null;
        if (NOTE_EDIT_TOOLS.has(name) && noteId)
          undo = { kind: "note-content", noteId, before: contentOf(await fullNote(noteId)) };
        if (LAYOUT_TOOLS.has(name)) undo = { kind: "layout", before: layoutOf(await library()) };
        const result = await tool.run(input);
        if (CREATE_TOOLS.has(name)) {
          const created = (result as { id?: unknown } | null)?.id;
          if (typeof created === "string") undo = { kind: "note-created", noteId: created };
        }
        if (name === "loam_notes_delete")
          undo = { kind: "note-deleted", note: result as NoteDocument };
        return { result, undo };
      },
    };
  };

  const pageTabOf = (note: NoteDocument, tabId: string | null) => {
    const pages = note.tabs.filter((tab) => tabKindOf(tab) === "page");
    const tab = tabId
      ? note.tabs.find((entry) => entry.id === tabId)
      : (pages.find((entry) => entry.id === note.activeTabId) ?? pages[0]);
    if (!tab) throw new StoreError("The note has no text tab to write to.", "NOT_FOUND", 404);
    if (tabKindOf(tab) !== "page")
      throw new StoreError(
        "Only text tabs take Markdown; use the diagram or table tools.",
        "VALIDATION_ERROR",
        400,
      );
    return tab;
  };

  const writeSchema = z.strictObject({
    noteId: uuidSchema,
    tabId: z.string().min(1).max(512).optional(),
    markdown: z.string().max(2 * 1024 * 1024),
    mode: z.enum(["replace", "append"]).default("replace"),
  });
  /** The note after a Markdown write, without saving it. */
  const applyWrite = async (note: NoteDocument, input: z.output<typeof writeSchema>) => {
    const tab = pageTabOf(note, input.tabId ?? null);
    const blocks = (await workspace.request({
      action: "parseMarkdown",
      text: input.markdown,
    })) as unknown[];
    const existing = note.blocksByTab[tab.id] ?? [];
    return {
      tab,
      note: {
        ...note,
        blocksByTab: {
          ...note.blocksByTab,
          [tab.id]: input.mode === "append" ? [...existing, ...blocks] : blocks,
        },
      },
    };
  };

  const readTool: ChatTool = {
    name: "loam_notes_read",
    description:
      "Read a note as Markdown, tab by tab, with its title, placement and updatedAt. Prefer this to notes_get unless you need the exact block JSON. Note links appear as /notes?noteId=<id>.",
    inputSchema: z.strictObject({ noteId: uuidSchema }),
    access: "read",
    describe: describeWith("loam_notes_read"),
    async run(input) {
      const { noteId } = z.strictObject({ noteId: uuidSchema }).parse(input);
      const [{ notes, folders, projects }, note] = await Promise.all([library(), fullNote(noteId)]);
      const titles = new Map(notes.map((entry) => [entry.id, entry.title]));
      const folder = folders.find((entry) => entry.id === note.folderId);
      const projectId = folder?.projectId ?? note.projectId;
      return {
        result: {
          id: note.id,
          title: note.title,
          updatedAt: note.updatedAt,
          folder: folder?.name ?? null,
          project: projects.find((entry) => entry.id === projectId)?.name ?? null,
          activeTabId: note.activeTabId,
          tabs: noteMarkdown(note, titles),
        },
        undo: null,
      };
    },
  };

  const writeTool: ChatTool = {
    name: "loam_notes_write",
    description:
      "Write Markdown into a note's text tab (the open text tab when tabId is omitted): replace its content, or append to it. Headings, lists, checklists (- [ ]), tables, code, quotes and links work; link notes with [Title](/notes?noteId=<id>). Other tabs are untouched.",
    inputSchema: writeSchema,
    access: "edit",
    describe: describeWith("loam_notes_write"),
    async preview(input) {
      const parsed = writeSchema.parse(input);
      return markdownPreview(parsed.noteId, async (note) => (await applyWrite(note, parsed)).note);
    },
    async run(input) {
      const parsed = writeSchema.parse(input);
      const before = await fullNote(parsed.noteId);
      const { tab, note } = await applyWrite(before, parsed);
      const saved = await call("notes.save", {
        noteId: parsed.noteId,
        patch: { blocksByTab: note.blocksByTab },
        baseUpdatedAt: before.updatedAt,
      });
      return {
        result: { tabId: tab.id, updatedAt: saved.updatedAt },
        undo: { kind: "note-content", noteId: parsed.noteId, before: contentOf(before) },
      };
    },
  };

  /** Puts back what a change did. */
  const undo = async (record: UndoRecord) => {
    await workspace.flush();
    switch (record.kind) {
      case "note-content": {
        // Undo writes over whatever the note holds now, as the user asked.
        const { updatedAt } = await call("notes.get", { noteId: record.noteId });
        await call("notes.save", {
          noteId: record.noteId,
          baseUpdatedAt: updatedAt,
          patch: {
            ...record.before,
            video: record.before.video ?? null,
            graphsByTab: record.before.graphsByTab ?? {},
            tablesByTab: record.before.tablesByTab ?? {},
            embedsByTab: record.before.embedsByTab ?? {},
          },
        });
        return;
      }
      case "note-created":
        await call("notes.delete", { noteId: record.noteId });
        return;
      case "note-deleted":
        await call("notes.restore", { note: record.note });
        return;
      case "layout": {
        // Notes made since keep their place; the layout must list every note.
        const now = layoutOf(await library());
        const listed = new Set(record.before.notes.map((note) => note.id));
        const present = new Set(now.notes.map((note) => note.id));
        const folderIds = new Set(record.before.folders.map((folder) => folder.id));
        await call("notes.saveLayout", {
          layout: {
            ...record.before,
            notes: [
              ...record.before.notes.filter((note) => present.has(note.id)),
              ...now.notes
                .filter((note) => !listed.has(note.id))
                .map((note) =>
                  note.folderId && !folderIds.has(note.folderId)
                    ? { ...note, folderId: null }
                    : note,
                ),
            ],
          },
        });
        return;
      }
    }
  };

  const all = (): ChatTool[] => [
    readTool,
    writeTool,
    ...extra,
    ...Object.entries(SHARED_TOOLS).map(([name, access]) => fromShared(name, access)),
  ];
  return { all, undo, titleOf };
};

export type ChatTools = ReturnType<typeof createChatTools>;
