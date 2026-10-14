import { describe, expect, it } from "vitest";

import type { NoteFolder, NoteProject } from "@loam/shared/notes/noteModel";

import type { NoteDocument } from "../../workspace/types";
import {
  applyNotesTreeMove,
  buildNotesTreeRows,
  canAcceptNotesTreeTarget,
  deleteCandidateFromKeys,
  folderDragId,
  moveNotesToFolder,
  moveToProject,
  noteDragId,
  NOTES_TREE_ROOT_DROP_ID,
  projectContents,
  projectDragId,
  returnToPlaces,
} from "../notesTreeModel";

const note = (
  id: string,
  place: { folderId?: string; projectId?: string } = {},
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
      closedProjectIds: new Set(closedProjects),
      creatingFolderIn,
    });

  it("lists projects with what they hold, then the top-level notes, drop strip and folders", () => {
    expect(build({ open: ["planning", "assets"] }).rows.map((row) => row.key)).toEqual([
      "project:launch",
      "note:pitch",
      "folder:assets",
      "note:logo",
      "project:garden",
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
      "note:root-first",
      "note:root-later",
      "root-drop",
      "folder:planning",
      "folder:archive",
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

  it("reorders notes within their group, and not across groups", () => {
    expect(movedNotes(move(noteDragId("root-later"), noteDragId("root-first")))?.[0]).toBe(
      "root-later in top",
    );
    expect(move(noteDragId("root-first"), noteDragId("folder-first"))).toBeNull();
    expect(
      canAcceptNotesTreeTarget({
        ...tree,
        sourceId: noteDragId("root-first"),
        targetId: noteDragId("pitch"),
      }),
    ).toBe(false);
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
