import { describe, expect, it } from "vitest";

import type { NoteTable } from "@loam/shared/notes/noteModel";

import {
  addCard,
  addGroup,
  boardGroups,
  cardFields,
  createNoteBoard,
  moveCard,
  withBoardGroups,
} from "../noteBoard";

const table = (): NoteTable => ({
  columns: [
    { id: "name", title: "Name", type: "text" },
    {
      id: "stage",
      title: "Stage",
      type: "select",
      options: [
        { id: "todo", label: "To do" },
        { id: "done", label: "Done" },
      ],
    },
    { id: "due", title: "Due", type: "date" },
  ],
  rows: [
    { id: "a", cells: { name: "Read", stage: "todo", due: "2026-10-20" } },
    { id: "b", cells: { name: "Write", stage: "todo" } },
    { id: "c", cells: { name: "Rest", stage: "" } },
  ],
  groupColumnId: "stage",
});

const layout = (board: NoteTable) =>
  boardGroups(board).map((group) => [group.label, group.rows.map((row) => row.id)]);

describe("note boards", () => {
  it("groups cards by the group column, with a column for cards without a choice", () => {
    expect(layout(table())).toEqual([
      ["To do", ["a", "b"]],
      ["Done", []],
      ["No group", ["c"]],
    ]);
    expect(cardFields(table(), table().rows[0]!)).toEqual([
      { id: "due", label: "Due", text: "2026-10-20" },
    ]);
  });

  it("starts a new board empty, in to do, doing and done", () => {
    const board = createNoteBoard();
    expect(board.columns.map((column) => column.title)).toEqual(["Title", "Notes", "Status"]);
    expect(layout(board)).toEqual([
      ["To do", []],
      ["Doing", []],
      ["Done", []],
    ]);
  });

  it("groups by the first select column, or a new Status column", () => {
    const { groupColumnId: _, ...ungrouped } = table();
    expect(withBoardGroups(ungrouped).groupColumnId).toBe("stage");

    const plain: NoteTable = { columns: [table().columns[0]!], rows: [table().rows[0]!] };
    const ready = withBoardGroups(plain);
    const status = ready.columns.find((column) => column.id === ready.groupColumnId)!;
    expect(status).toMatchObject({ title: "Status", type: "select" });
    expect(status.options!.map((option) => option.label)).toEqual(["To do", "Doing", "Done"]);
    expect(layout(ready)).toEqual([
      ["To do", ["a"]],
      ["Doing", []],
      ["Done", []],
    ]);
  });

  it("moves a card to another group, before a card or after the group's last", () => {
    expect(layout(moveCard(table(), "b", "done")!)[1]).toEqual(["Done", ["b"]]);
    expect(layout(moveCard(table(), "b", "todo", "a")!)[0]).toEqual(["To do", ["b", "a"]]);
    expect(moveCard(table(), "b", "todo")).toBeNull();
  });

  it("adds cards and columns", () => {
    const added = addCard(table(), "done", "Review");
    const card = added.rows.find((row) => row.cells.name === "Review")!;
    expect(card.cells.stage).toBe("done");
    expect(layout(addGroup(table(), "Blocked")).map(([label]) => label)).toEqual([
      "To do",
      "Done",
      "Blocked",
      "No group",
    ]);
  });
});
