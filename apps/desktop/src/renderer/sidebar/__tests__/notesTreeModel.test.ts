import { describe, expect, it } from "vitest";

import type { NoteFolder, NoteProject } from "@loam/shared/notes/noteModel";

import type { NoteDocument } from "../../workspace/types";
import {
  applyNotesTreeMove,
  buildNotesTreeRows,
  canAcceptNotesTreeTarget,
  canNestNotesTreeTarget,
  deleteCandidateFromKeys,
  folderDragId,
  moveNotesToFolder,
  moveOutOfParent,
  moveToProject,
  noteAncestorIds,
  notePlaceOf,
  noteDragId,
  NOTES_TREE_ROOT_DROP_ID,
  NOTES_TREE_START_DROP_ID,
  dropsInsideNotesTreeTarget,
  projectContents,
  projectDragId,
  returnToPlaces,
} from "../notesTreeModel";

const note = (
  id: string,
  place: { folderId?: string; projectId?: string; parentNoteId?: string } = {},
  position = 0,
): NoteDocument => ({
  id,
  title: id,
  updatedAt: "2026-03-31T00:00:00.000Z",
  tabs: [{ id: `${id}-tab`, title: "Notes" }],
  blocksByTab: { [`${id}-tab`]: [] },
  activeTabId: `${id}-tab`,
  ...place,
  position,
});

const projects: NoteProject[] = [
  { id: "launch", name: "Launch", position: 0 },
  { id: "garden", name: "Garden", position: 1 },
];

const folders: NoteFolder[] = [
  { id: "planning", name: "Planning", position: 0 },
  { id: "assets", name: "Assets", position: 1, projectId: "launch" },
  { id: "archive", name: "Archive", position: 2 },
];

const notes = [
  note("root-first", {}, 0),
  note("root-later", {}, 1),
  note("folder-first", { folderId: "planning" }, 0),
  note("folder-second", { folderId: "planning" }, 1),
  note("pitch", { projectId: "launch" }, 0),
  note("logo", { folderId: "assets" }, 0),
];

const tree = { notes, folders, projects };

/** Where each note ends up, in layout order. */
const places = (
  moved: readonly Pick<NoteDocument, "id" | "folderId" | "projectId">[] | null | undefined,
) => moved?.map(({ id, folderId, projectId }) => [id, folderId ?? projectId ?? "top"].join(" in "));

const movedNotes = (move: ReturnType<typeof applyNotesTreeMove>) =>
  places(move?.kind === "notes" ? move.notes : null);

describe("notes tree rows", () => {
  const build = ({
    open = [],
    closedProjects = [],
    folderScopeId,
    projectScope,
    creatingFolderIn,
  }: {
    open?: string[];
    closedProjects?: string[];
    folderScopeId?: string | null;
    projectScope?: Set<string | null>;
    creatingFolderIn?: string | null;
  } = {}) =>
    buildNotesTreeRows({
      ...tree,
      folderScopeId,
      projectScope,
      openFolderIds: new Set(open),
      openNoteIds: new Set(),
      closedProjectIds: new Set(closedProjects),
      creatingFolderIn,
    });

  it("lists projects with what they hold, then the top-level notes, drop strips and folders", () => {
    expect(build({ open: ["planning", "assets"] }).rows.map((row) => row.key)).toEqual([
      "project:launch",
      "note:pitch",
      "folder:assets",
      "note:logo",
      "project:garden",
      "root-drop-start",
      "note:root-first",
      "note:root-later",
      "root-drop",
      "folder:planning",
      "note:folder-first",
      "note:folder-second",
      "folder:archive",
    ]);
    // Projects are never selected, so they aren't among the keys to select.
    expect(build({ closedProjects: ["launch"] }).keys).toEqual([
      "note:root-first",
      "note:root-later",
      "folder:planning",
      "folder:archive",
    ]);
  });

  it("nests rows a level deeper inside a project, and marks an empty project", () => {
    const rows = build({ open: ["assets"] }).rows;
    const depths = rows.flatMap((row) =>
      row.kind === "note" || row.kind === "folder" ? [`${row.key} ${row.depth}`] : [],
    );
    expect(depths.slice(0, 3)).toEqual(["note:pitch 1", "folder:assets 1", "note:logo 2"]);
    expect(rows.flatMap((row) => (row.kind === "project" ? [row.isEmpty] : []))).toEqual([
      false,
      true,
    ]);
  });

  it("names the last row inside an open folder or project, where a drop after it is drawn", () => {
    const lastChildren = build({ open: ["planning", "assets", "archive"] }).rows.flatMap((row) =>
      row.kind === "folder" || row.kind === "project" ? [row.lastChildKey] : [],
    );
    expect(lastChildren).toEqual(["note:logo", "note:logo", null, "note:folder-second", null]);
  });

  it("keeps what is in scope selectable, even inside closed folders and projects", () => {
    expect([...build({ folderScopeId: "planning" }).scopeKeys]).toEqual([
      "folder:planning",
      "note:folder-first",
      "note:folder-second",
    ]);
    expect([...build({ folderScopeId: null }).scopeKeys]).toEqual([
      "note:root-first",
      "note:root-later",
    ]);
    expect([...build({ closedProjects: ["launch"] }).scopeKeys]).toContain("note:logo");
  });

  it("shows only the projects chosen, with null for what is outside projects", () => {
    expect(build({ projectScope: new Set(["launch"]) }).rows.map((row) => row.key)).toEqual([
      "project:launch",
      "note:pitch",
      "folder:assets",
    ]);
    expect(build({ projectScope: new Set([null, "garden"]) }).rows.map((row) => row.key)).toEqual([
      "project:garden",
      "root-drop-start",
      "note:root-first",
      "note:root-later",
      "root-drop",
      "folder:planning",
      "folder:archive",
    ]);
  });

  it("puts a strip above the top-level notes only when projects show over them", () => {
    const keys = (scope: Set<string | null>) =>
      build({ projectScope: scope }).rows.map((row) => row.key);
    expect(keys(new Set([null]))[0]).toBe("note:root-first");
    expect(build({ folderScopeId: null }).rows[0]?.key).toBe("note:root-first");
    const withoutLooseNotes = buildNotesTreeRows({
      notes: [note("pitch", { projectId: "launch" })],
      folders: [],
      projects,
      folderScopeId: undefined,
      projectScope: undefined,
      openFolderIds: new Set(),
      openNoteIds: new Set(),
      closedProjectIds: new Set(),
      creatingFolderIn: undefined,
    });
    expect(withoutLooseNotes.rows.map((row) => row.key)).toEqual([
      "project:launch",
      "note:pitch",
      "project:garden",
      "root-drop",
    ]);
  });

  it("names a new folder inside its project, opening the project", () => {
    const rows = build({ closedProjects: ["launch"], creatingFolderIn: "launch" }).rows;
    expect(rows.slice(0, 4).map((row) => row.key)).toEqual([
      "project:launch",
      "note:pitch",
      "folder:assets",
      "creating-folder",
    ]);
  });
});

describe("notes tree helpers", () => {
  it("turns selection keys into the items to delete that still exist", () => {
    const exists = ({ id }: { id: string }) => id !== "gone";
    expect(
      deleteCandidateFromKeys(["note:a", "folder:b", "note:gone", "project:c", "other"], exists),
    ).toEqual({ noteIds: ["a"], folderIds: ["b"] });
    expect(deleteCandidateFromKeys(["note:gone"], exists)).toBeNull();
  });

  it("lists what a project holds directly", () => {
    expect(projectContents({ notes, folders, projectId: "launch" })).toEqual({
      noteIds: ["pitch"],
      folderIds: ["assets"],
    });
  });
});

describe("moving in the notes tree by drag and drop", () => {
  const move = (sourceId: string, targetId: string, half: "before" | "after" = "before") =>
    applyNotesTreeMove({ ...tree, sourceId, targetId, half });

  it("nests a note into a folder and moves it back to the top level", () => {
    const nested = move(noteDragId("root-first"), folderDragId("planning"));
    expect(movedNotes(nested)).toEqual([
      "root-later in top",
      "pitch in launch",
      "folder-first in planning",
      "folder-second in planning",
      "root-first in planning",
      "logo in assets",
    ]);

    const unfiled = applyNotesTreeMove({
      ...tree,
      notes: nested?.kind === "notes" ? nested.notes : [],
      sourceId: noteDragId("root-first"),
      targetId: NOTES_TREE_ROOT_DROP_ID,
      half: "after",
    });
    expect(movedNotes(unfiled)?.slice(0, 2)).toEqual(["root-later in top", "root-first in top"]);
  });

  it("drops a note into a project, at the end of the project's own notes", () => {
    expect(movedNotes(move(noteDragId("logo"), projectDragId("launch")))).toContain(
      "logo in launch",
    );
  });

  it("puts a note dropped on the strip above the top-level notes first among them", () => {
    expect(movedNotes(move(noteDragId("root-later"), NOTES_TREE_START_DROP_ID))).toEqual([
      "root-later in top",
      "root-first in top",
      "pitch in launch",
      "folder-first in planning",
      "folder-second in planning",
      "logo in assets",
    ]);
    // Out of a project, too.
    expect(movedNotes(move(noteDragId("pitch"), NOTES_TREE_START_DROP_ID))?.[0]).toBe(
      "pitch in top",
    );
  });

  it("drops inside a folder or project on either half, unless reordering its own kind", () => {
    expect(dropsInsideNotesTreeTarget(noteDragId("pitch"), projectDragId("launch"))).toBe(true);
    expect(dropsInsideNotesTreeTarget(noteDragId("pitch"), folderDragId("planning"))).toBe(true);
    expect(dropsInsideNotesTreeTarget(folderDragId("planning"), projectDragId("launch"))).toBe(
      true,
    );
    expect(dropsInsideNotesTreeTarget(folderDragId("planning"), folderDragId("archive"))).toBe(
      false,
    );
    expect(dropsInsideNotesTreeTarget(projectDragId("garden"), projectDragId("launch"))).toBe(
      false,
    );
    expect(dropsInsideNotesTreeTarget(noteDragId("pitch"), noteDragId("root-first"))).toBe(false);
    expect(dropsInsideNotesTreeTarget(noteDragId("pitch"), NOTES_TREE_START_DROP_ID)).toBe(false);
  });

  it("reorders notes, and moves a note dropped beside one in another group there", () => {
    expect(movedNotes(move(noteDragId("root-later"), noteDragId("root-first")))?.[0]).toBe(
      "root-later in top",
    );
    expect(movedNotes(move(noteDragId("root-first"), noteDragId("folder-second")))).toEqual([
      "root-later in top",
      "pitch in launch",
      "folder-first in planning",
      "root-first in planning",
      "folder-second in planning",
      "logo in assets",
    ]);
  });

  it("moves folders among folders, into a project, or out to the top level", () => {
    const reordered = move(folderDragId("planning"), folderDragId("archive"), "after");
    expect(reordered?.kind === "folders" && reordered.folders.map((folder) => folder.id)).toEqual([
      "assets",
      "archive",
      "planning",
    ]);

    // Beside a folder in another project, the folder joins that project.
    const beside = move(folderDragId("archive"), folderDragId("assets"), "after");
    expect(beside?.kind === "folders" && beside.folders.at(-1)).toMatchObject({
      id: "archive",
      projectId: "launch",
    });

    const intoProject = move(folderDragId("planning"), projectDragId("garden"));
    expect(intoProject?.kind === "folders" && intoProject.folders.at(-1)).toMatchObject({
      id: "planning",
      projectId: "garden",
    });

    const out = move(folderDragId("assets"), NOTES_TREE_ROOT_DROP_ID);
    expect(out?.kind === "folders" && out.folders.at(-1)?.projectId).toBeUndefined();
    expect(
      canAcceptNotesTreeTarget({
        ...tree,
        sourceId: folderDragId("archive"),
        targetId: noteDragId("folder-first"),
      }),
    ).toBe(false);
  });

  it("reorders projects only among projects", () => {
    const reordered = move(projectDragId("garden"), projectDragId("launch"));
    expect(reordered).toEqual({
      kind: "projects",
      projects: [
        { ...projects[1], position: 0 },
        { ...projects[0], position: 1 },
      ],
    });
    expect(
      canAcceptNotesTreeTarget({
        ...tree,
        sourceId: projectDragId("garden"),
        targetId: folderDragId("planning"),
      }),
    ).toBe(false);
  });
});

describe("moving in the notes tree from the menu", () => {
  it("takes notes out of their folders without leaving their project", () => {
    expect(
      places(moveNotesToFolder({ ...tree, noteIds: ["logo", "folder-first"], folderId: null })),
    ).toEqual(expect.arrayContaining(["logo in launch", "folder-first in top"]));
  });

  it("moves notes and folders into a project, and back out of every project", () => {
    const moved = moveToProject({
      ...tree,
      noteIds: ["folder-first"],
      folderIds: ["archive"],
      projectId: "garden",
    });
    expect(places(moved?.notes)).toContain("folder-first in garden");
    expect(moved?.folders.find((folder) => folder.id === "archive")?.projectId).toBe("garden");

    const out = moveToProject({ ...tree, noteIds: ["pitch"], folderIds: [], projectId: null });
    expect(places(out?.notes)).toContain("pitch in top");
    expect(moveToProject({ ...tree, noteIds: ["pitch"], folderIds: [], projectId: "launch" })).toBe(
      null,
    );
  });

  it("puts moved notes and folders back where they were", () => {
    const moved = moveToProject({
      ...tree,
      noteIds: ["folder-second"],
      folderIds: ["assets"],
      projectId: null,
    })!;
    const returned = returnToPlaces({
      ...moved,
      projects,
      before: { notes, folders },
      noteIds: ["folder-second"],
      folderIds: ["assets"],
    });
    expect(places(returned?.notes)).toEqual([
      "root-first in top",
      "root-later in top",
      "pitch in launch",
      "folder-first in planning",
      "folder-second in planning",
      "logo in assets",
    ]);
    expect(returned?.folders.map(({ id, projectId }) => [id, projectId])).toEqual([
      ["planning", undefined],
      ["assets", "launch"],
      ["archive", undefined],
    ]);
  });
});

describe("sub-notes in the notes tree", () => {
  // "pitch" in the Launch project holds "brief", which holds "draft".
  const nested = {
    notes: [
      ...notes,
      note("brief", { parentNoteId: "pitch" }, 0),
      note("draft", { parentNoteId: "brief" }, 0),
      note("notes", { parentNoteId: "pitch" }, 1),
    ],
    folders,
    projects,
  };
  const subPlaces = (moved: readonly NoteDocument[] | null | undefined) =>
    moved?.map(({ id, folderId, projectId, parentNoteId }) =>
      [id, parentNoteId ?? folderId ?? projectId ?? "top"].join(" in "),
    );
  const move = (
    sourceId: string,
    targetId: string,
    half: "before" | "after" = "before",
    inside = false,
  ) => {
    const moved = applyNotesTreeMove({ ...nested, sourceId, targetId, half, inside });
    return subPlaces(moved?.kind === "notes" ? moved.notes : null);
  };
  const rowsFor = (openNoteIds: string[]) =>
    buildNotesTreeRows({
      ...nested,
      folderScopeId: undefined,
      projectScope: new Set(["launch"]),
      openFolderIds: new Set(),
      openNoteIds: new Set(openNoteIds),
      closedProjectIds: new Set(),
      creatingFolderIn: undefined,
    }).rows;

  it("shows sub-notes under their note while it is open, one level deeper each", () => {
    expect(rowsFor([]).map((row) => row.key)).toEqual([
      "project:launch",
      "note:pitch",
      "folder:assets",
    ]);
    const rows = rowsFor(["pitch", "brief"]);
    expect(rows.flatMap((row) => (row.kind === "note" ? [`${row.id}:${row.depth}`] : []))).toEqual([
      "pitch:1",
      "brief:2",
      "draft:3",
      "notes:2",
    ]);
    const pitch = rows.find((row) => row.key === "note:pitch");
    expect(pitch).toMatchObject({ hasSubNotes: true, isOpen: true, lastChildKey: "note:notes" });
  });

  it("finds where a sub-note shows through the notes it is inside", () => {
    expect(noteAncestorIds(nested.notes, folders, "draft")).toEqual(["brief", "pitch"]);
    const draft = nested.notes.find((entry) => entry.id === "draft");
    expect(notePlaceOf(nested, draft)).toEqual({ folderId: null, projectId: "launch" });
  });

  it("drops a note inside another, at the end of its sub-notes", () => {
    expect(move(noteDragId("root-first"), noteDragId("pitch"), "before", true)).toContain(
      "root-first in pitch",
    );
    expect(
      canNestNotesTreeTarget({
        ...nested,
        sourceId: noteDragId("root-first"),
        targetId: folderDragId("planning"),
      }),
    ).toBe(false);
  });

  it("never drops a note inside itself or its own sub-notes", () => {
    const into = (targetId: string) =>
      canAcceptNotesTreeTarget({ ...nested, sourceId: noteDragId("pitch"), targetId });
    expect(into(noteDragId("draft"))).toBe(false);
    expect(into(noteDragId("brief"))).toBe(false);
    expect(into(noteDragId("root-first"))).toBe(true);
    expect(move(noteDragId("pitch"), noteDragId("draft"), "before", true)).toBeUndefined();
  });

  it("takes a sub-note out by dropping it beside a note elsewhere, with its own sub-notes", () => {
    const moved = move(noteDragId("brief"), noteDragId("root-first"), "after");
    expect(moved).toContain("brief in top");
    expect(moved).toContain("draft in brief");
    expect(move(noteDragId("brief"), NOTES_TREE_ROOT_DROP_ID)).toContain("brief in top");
    expect(move(noteDragId("brief"), folderDragId("planning"))).toContain("brief in planning");
  });

  it("moves a sub-note out to just after its parent from the menu", () => {
    const moved = subPlaces(moveOutOfParent({ ...nested, noteId: "brief" }));
    expect(moved?.slice(0, 3)).toEqual([
      "root-first in top",
      "root-later in top",
      "pitch in launch",
    ]);
    expect(moved?.[3]).toBe("brief in launch");
    expect(moveOutOfParent({ ...nested, noteId: "pitch" })).toBeNull();
  });

  it("shows notes nested inside each other, as two computers can leave them, at the top", () => {
    const looped = [note("a", { parentNoteId: "b" }, 0), note("b", { parentNoteId: "a" }, 1)];
    const { rows } = buildNotesTreeRows({
      notes: looped,
      folders: [],
      projects: [],
      folderScopeId: undefined,
      projectScope: undefined,
      openFolderIds: new Set(),
      openNoteIds: new Set(),
      closedProjectIds: new Set(),
      creatingFolderIn: undefined,
    });
    expect(rows.map((row) => row.key)).toEqual(["note:a", "note:b", "root-drop"]);
  });
});
