import { describe, expect, it } from "vitest";

import {
  compareNoteTableCells,
  normalizeNoteTable,
  noteTableCellText,
  parseNoteTableCellText,
  parseNoteTableCellValue,
  reconcileNoteTableSelectOptions,
} from "../noteTable";

describe("note table model", () => {
  it("parses supported typed values without storing invalid dates or numbers", () => {
    expect(parseNoteTableCellValue("12.5", "number")).toBe(12.5);
    expect(parseNoteTableCellValue("not a number", "number")).toBeNull();
    expect(parseNoteTableCellValue("yes", "boolean")).toBe(true);
    expect(parseNoteTableCellValue("2026-07-11", "date")).toBe("2026-07-11");
    expect(parseNoteTableCellValue("11/07/2026", "date")).toBeNull();
  });

  it("normalizes select choices and removes cells for missing columns", () => {
    const table = normalizeNoteTable({
      columns: [
        {
          id: "status",
          title: " Status ",
          type: "select",
          width: 900,
          headingBlockIds: [" heading-1 ", "heading-1", "", "heading-2"],
          options: [
            { id: "todo", label: " To do " },
            { id: "blank", label: " " },
          ],
        },
      ],
      rows: [
        {
          id: "row-1",
          cells: { status: "todo", removed: "ignore" },
          headingBlockIds: ["heading-2", "heading-2"],
        },
      ],
    });

    expect(table).toEqual({
      columns: [
        {
          id: "status",
          title: "Status",
          type: "select",
          width: 480,
          position: 0,
          options: [{ id: "todo", label: "To do" }],
          headingBlockIds: ["heading-1", "heading-2"],
        },
      ],
      rows: [
        {
          id: "row-1",
          position: 0,
          cells: { status: "todo" },
          headingBlockIds: ["heading-2"],
        },
      ],
    });
  });

  it("omits empty heading connection arrays while normalizing table data", () => {
    const table = normalizeNoteTable({
      columns: [
        {
          id: "topic",
          title: "Topic",
          type: "text",
          headingBlockIds: [" ", ""],
        },
      ],
      rows: [
        {
          id: "row-1",
          cells: { topic: "Example" },
          headingBlockIds: [],
        },
      ],
    });

    expect(table?.columns[0]).not.toHaveProperty("headingBlockIds");
    expect(table?.rows[0]).not.toHaveProperty("headingBlockIds");
  });

  it("keeps choice ids while a choice is retyped, removed, or added", () => {
    const base = [
      { id: "done", label: "Done" },
      { id: "open", label: "Open" },
    ];
    let next = 0;
    const createId = () => `new-${(next += 1)}`;

    // Every keystroke is matched against the choices from before the edit.
    expect(reconcileNoteTableSelectOptions(base, ["Open"], createId)).toEqual([
      { id: "open", label: "Open" },
    ]);
    expect(reconcileNoteTableSelectOptions(base, ["Completed", "Open"], createId)).toEqual([
      { id: "done", label: "Completed" },
      { id: "open", label: "Open" },
    ]);
    expect(reconcileNoteTableSelectOptions(base, ["Done", "Blocked", "Open"], createId)).toEqual([
      { id: "done", label: "Done" },
      { id: "new-1", label: "Blocked" },
      { id: "open", label: "Open" },
    ]);
  });

  it("filters and sorts select cells by what they show", () => {
    const column = {
      id: "status",
      title: "Status",
      type: "select" as const,
      options: [
        { id: "z-id", label: "Todo" },
        { id: "a-id", label: "Done" },
      ],
    };

    expect(noteTableCellText(column, "a-id")).toBe("Done");
    expect(noteTableCellText(column, "missing")).toBe("");
    // Pasting a label picks its choice.
    expect(parseNoteTableCellText(column, " done ")).toBe("a-id");
    // Choices sort in list order, and empty cells after every choice.
    const values = ["a-id", null, "z-id"];
    expect(values.sort((left, right) => compareNoteTableCells(column, left, right))).toEqual([
      "z-id",
      "a-id",
      null,
    ]);
    expect(compareNoteTableCells({ id: "n", title: "N", type: "number" }, 10, 9)).toBeGreaterThan(
      0,
    );
  });
});
