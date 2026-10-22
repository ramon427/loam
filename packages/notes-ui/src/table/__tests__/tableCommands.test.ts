import { describe, expect, it } from "vitest";

import type { NoteTable } from "@loam/shared/notes/noteModel";

import {
  addNoteTableColumn,
  addNoteTableRow,
  changeNoteTableRow,
  deleteNoteTableColumn,
  duplicateNoteTableColumn,
  duplicateNoteTableRow,
  positionNoteTable,
  replaceNoteTableCells,
  shiftNoteTableColumn,
  visibleNoteTableRows,
} from "../tableCommands";

const table: NoteTable = {
  columns: [
    { id: "topic", title: "Topic", type: "text" },
    {
      id: "status",
      title: "Status",
      type: "select",
      options: [
        { id: "z-id", label: "Todo" },
        { id: "a-id", label: "Done" },
      ],
    },
  ],
  rows: [
    { id: "row-1", cells: { topic: "Guard", status: "a-id" } },
    { id: "row-2", cells: { topic: "Mount", status: "z-id" } },
    { id: "row-3", cells: { topic: "Back", status: null } },
  ],
};

const ids = (rows: readonly { id: string }[] | undefined) => rows?.map((row) => row.id);

describe("table commands", () => {
  it("preserves row connections when grid cells are replaced", () => {
    const table = replaceNoteTableCells(
      {
        columns: [
          { id: "topic", title: "Topic", type: "text" },
          { id: "score", title: "Score", type: "number" },
        ],
        rows: [
          {
            id: "row-1",
            position: 2,
            cells: { topic: "Before", score: 1 },
            headingBlockIds: ["heading-1", "heading-2"],
          },
          { id: "row-2", position: 3, cells: { topic: "Untouched" } },
        ],
      },
      new Map([["row-1", { topic: "After" }]]),
    );

    expect(table.rows).toEqual([
      {
        id: "row-1",
        position: 2,
        cells: { topic: "After", score: null },
        headingBlockIds: ["heading-1", "heading-2"],
      },
      { id: "row-2", position: 3, cells: { topic: "Untouched" } },
    ]);
  });

  it("copies heading connections when rows and columns are duplicated", () => {
    const row = {
      id: "row-1",
      cells: { topic: "Setup" },
      headingBlockIds: ["heading-1"],
    };
    expect(duplicateNoteTableRow(row, "row-copy")).toEqual({
      id: "row-copy",
      cells: { topic: "Setup" },
      headingBlockIds: ["heading-1"],
    });

    const table = duplicateNoteTableColumn(
      {
        columns: [
          {
            id: "topic",
            title: "Topic",
            type: "text",
            headingBlockIds: ["heading-2"],
          },
        ],
        rows: [row],
      },
      "topic",
      "topic-copy",
    );

    expect(table).toEqual({
      columns: [
        {
          id: "topic",
          title: "Topic",
          type: "text",
          headingBlockIds: ["heading-2"],
        },
        {
          id: "topic-copy",
          title: "Topic (1)",
          type: "text",
          headingBlockIds: ["heading-2"],
        },
      ],
      rows: [
        {
          id: "row-1",
          cells: { topic: "Setup", "topic-copy": "Setup" },
          headingBlockIds: ["heading-1"],
        },
      ],
    });
  });

  it("shows rows whose cells match the filter, in the chosen choice order", () => {
    expect(ids(visibleNoteTableRows(table, " DONE ", null))).toEqual(["row-1"]);
    expect(ids(visibleNoteTableRows(table, "", { columnId: "status", direction: "ASC" }))).toEqual([
      "row-2",
      "row-1",
      "row-3",
    ]);
    expect(ids(visibleNoteTableRows(table, "", { columnId: "status", direction: "DESC" }))).toEqual(
      ["row-3", "row-1", "row-2"],
    );
  });

  it("moves, copies, and removes rows, and refuses moves past either end", () => {
    expect(ids(changeNoteTableRow(table, "row-2", "up")?.rows)).toEqual([
      "row-2",
      "row-1",
      "row-3",
    ]);
    expect(changeNoteTableRow(table, "row-1", "up")).toBeNull();
    expect(changeNoteTableRow(table, "row-3", "down")).toBeNull();
    expect(ids(changeNoteTableRow(table, "row-2", "delete")?.rows)).toEqual(["row-1", "row-3"]);
    const duplicated = changeNoteTableRow(table, "row-1", "duplicate");
    expect(duplicated?.rows).toHaveLength(4);
    expect(duplicated?.rows[1]?.cells).toEqual(table.rows[0]?.cells);
  });

  it("adds an empty row or column at a place, or after the last one", () => {
    const appended = addNoteTableRow(table);
    expect(ids(appended?.table.rows)).toEqual(["row-1", "row-2", "row-3", appended?.row.id]);
    const inserted = addNoteTableRow(table, 1);
    expect(ids(inserted?.table.rows)).toEqual(["row-1", inserted?.row.id, "row-2", "row-3"]);
    expect(inserted?.row.cells).toEqual({ topic: "", status: "" });

    const column = addNoteTableColumn(table, 0);
    expect(column?.table.columns.map((candidate) => candidate.id)).toEqual([
      column?.column.id,
      "topic",
      "status",
    ]);
    expect(column?.table.rows.every((row) => row.cells[column.column.id] === "")).toBe(true);
  });

  it("adds, moves, and deletes columns but keeps the last one", () => {
    const added = addNoteTableColumn(table);
    expect(added?.table.columns.map((column) => column.title)).toEqual([
      "Topic",
      "Status",
      "Column 3",
    ]);
    expect(added?.table.rows.every((row) => row.cells[added.column.id] === "")).toBe(true);

    expect(shiftNoteTableColumn(table, "topic", 1)?.columns.map((column) => column.id)).toEqual([
      "status",
      "topic",
    ]);
    expect(shiftNoteTableColumn(table, "topic", -1)).toBeNull();

    const single = deleteNoteTableColumn(table, "status");
    expect(single?.columns.map((column) => column.id)).toEqual(["topic"]);
    expect(single?.rows[0]?.cells).toEqual({ topic: "Guard" });
    expect(deleteNoteTableColumn(single!, "topic")).toBeNull();
  });

  it("numbers columns and rows by their place", () => {
    const positioned = positionNoteTable(changeNoteTableRow(table, "row-3", "up")!);
    expect(positioned.rows.map((row) => [row.id, row.position])).toEqual([
      ["row-1", 0],
      ["row-3", 1],
      ["row-2", 2],
    ]);
    expect(positioned.columns.map((column) => column.position)).toEqual([0, 1]);
  });
});
