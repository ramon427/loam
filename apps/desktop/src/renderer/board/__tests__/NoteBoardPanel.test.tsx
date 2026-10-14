// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { NoteTable } from "@loam/shared/notes/noteModel";

import { NoteBoardPanel } from "../NoteBoardPanel";

const table: NoteTable = {
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
  ],
  rows: [{ id: "a", cells: { name: "Read", stage: "todo" } }],
  groupColumnId: "stage",
};

const renderBoard = () => {
  const onUpdateTable = vi.fn();
  render(
    <NoteBoardPanel
      tabId="board"
      table={table}
      onUpdateTable={onUpdateTable}
      historyBridgeRef={{ current: null }}
    />,
  );
  return onUpdateTable;
};

const lastTable = (onUpdateTable: ReturnType<typeof vi.fn>) =>
  onUpdateTable.mock.lastCall![0] as NoteTable;

describe("NoteBoardPanel", () => {
  it("adds a card to a column", () => {
    const onUpdateTable = renderBoard();
    const done = screen.getByRole("region", { name: "Done" });
    fireEvent.click(within(done).getByRole("button", { name: "Add card" }));
    const input = within(done).getByRole("textbox", { name: "New card in Done" });
    fireEvent.change(input, { target: { value: "Review" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(lastTable(onUpdateTable).rows.at(-1)!.cells).toMatchObject({
      name: "Review",
      stage: "done",
    });
  });

  it("moves a card from its menu", async () => {
    const onUpdateTable = renderBoard();
    fireEvent.keyDown(screen.getByRole("button", { name: "Actions for Read" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Done" }));
    expect(lastTable(onUpdateTable).rows[0]!.cells.stage).toBe("done");
  });

  it("moves a dropped card into the column it lands in", () => {
    const onUpdateTable = renderBoard();
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? "",
      get types() {
        return [...data.keys()];
      },
    };
    fireEvent.dragStart(screen.getByText("Read").closest("li")!, { dataTransfer });
    const done = screen.getByRole("region", { name: "Done" });
    fireEvent.dragOver(done, { dataTransfer });
    fireEvent.drop(done, { dataTransfer });
    expect(lastTable(onUpdateTable).rows[0]!.cells.stage).toBe("done");
  });
});
