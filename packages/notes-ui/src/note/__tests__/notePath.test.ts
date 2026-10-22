import { describe, expect, it } from "vitest";

import { notePathOf } from "../notePath";

const projects = [{ id: "p", name: "Work", position: 0 }];
const folders = [{ id: "f", name: "Plans", position: 0, projectId: "p" }];
const note = (
  id: string,
  place: { folderId?: string; projectId?: string; parentNoteId?: string },
) => ({
  id,
  title: id,
  ...place,
});

describe("notePathOf", () => {
  it("names a sub-note's parents outermost first, with the top parent's folder and project", () => {
    const notes = [
      note("trip", { folderId: "f" }),
      note("packing", { parentNoteId: "trip" }),
      note("shoes", { parentNoteId: "packing" }),
    ];
    const path = notePathOf(notes[2], { notes, folders, projects });
    expect(path.project?.name).toBe("Work");
    expect(path.folder?.name).toBe("Plans");
    expect(path.parents.map((parent) => parent.id)).toEqual(["trip", "packing"]);
  });

  it("finds the project of a note outside folders, and nothing for a top-level note", () => {
    const notes = [note("loose", { projectId: "p" }), note("top", {})];
    expect(notePathOf(notes[0], { notes, folders, projects })).toEqual({
      project: projects[0],
      folder: undefined,
      parents: [],
    });
    expect(notePathOf(notes[1], { notes, folders, projects })).toEqual({
      project: undefined,
      folder: undefined,
      parents: [],
    });
  });

  it("stops at a missing parent and at a loop of parents", () => {
    const orphan = note("orphan", { parentNoteId: "gone" });
    expect(notePathOf(orphan, { notes: [orphan], folders, projects }).parents).toEqual([]);
    const notes = [note("a", { parentNoteId: "b" }), note("b", { parentNoteId: "a" })];
    expect(notePathOf(notes[0], { notes, folders, projects }).parents.map((p) => p.id)).toEqual([
      "b",
    ]);
  });
});
