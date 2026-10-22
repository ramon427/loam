// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { NoteTable } from "@loam/shared/notes/noteModel";
import type { TabHistoryCommands } from "../../note/useTypedTabHistory";

import { NoteTablePanel, type NoteTableSelection } from "../NoteTablePanel";

const table: NoteTable = {
  columns: [
    { id: "topic", title: "Topic", type: "text" },
    { id: "notes", title: "Notes", type: "text" },
  ],
  rows: [
    { id: "row-1", cells: { topic: "Guard", notes: "" } },
    { id: "row-2", cells: { topic: "Mount", notes: "" } },
  ],
};

// The grid scrolls the selected cell into view; jsdom lacks scrollIntoView.
Element.prototype.scrollIntoView ??= vi.fn();

const renderTable = ({ initial = table, readOnly = false } = {}) => {
  const saved: NoteTable[] = [];
  const historyBridgeRef: { current: TabHistoryCommands | null } = { current: null };
  let selection: NoteTableSelection | null = null;

  function Harness() {
    const [current, setCurrent] = useState(initial);
    const [selectedTarget, setSelectedTarget] = useState<NoteTableSelection | null>(null);
    return (
      <NoteTablePanel
        tab={{ id: "table-tab", title: "Table", kind: "table" }}
        table={current}
        selectedTarget={selectedTarget}
        readOnly={readOnly}
        onSelectTarget={(target) => {
          selection = target;
          setSelectedTarget(target);
        }}
        onUpdateTable={(next) => {
          saved.push(next);
          setCurrent(next);
        }}
        headingOptions={[]}
        onToggleHeadingConnection={vi.fn()}
        onOpenHeading={vi.fn()}
        historyBridgeRef={historyBridgeRef}
      />
    );
  }

  render(<Harness />);
  return {
    lastSaved: () => saved.at(-1),
    savedCount: () => saved.length,
    selection: () => selection,
    undo: () =>
      act(() => {
        historyBridgeRef.current?.undo();
      }),
  };
};

const topics = (saved: NoteTable | undefined) => saved?.rows.map((row) => row.cells.topic);
const columnIds = (saved: NoteTable | undefined) => saved?.columns.map((column) => column.id);

const rightClick = (element: Element) =>
  fireEvent.contextMenu(element, { clientX: 10, clientY: 10 });

const openRowMenu = (text: string) => rightClick(screen.getByText(text));

// jsdom has no layout, so the grid renders only the first column's header.
const openColumnMenu = () =>
  rightClick(screen.getByRole("group", { name: "Topic column controls" }));

const menuItem = (name: string) => screen.findByRole("menuitem", { name });

const choose = async (name: string) => fireEvent.click(await menuItem(name));

const isDisabled = async (name: string) =>
  (await menuItem(name)).getAttribute("aria-disabled") === "true";

const shownTopics = () =>
  screen
    .getAllByRole("gridcell")
    .filter((cell) => cell.getAttribute("aria-colindex") === "2")
    .map((cell) => cell.textContent);

describe("table right-click menu", () => {
  it("selects the right-clicked row and inserts a row below it as one undo step", async () => {
    const view = renderTable();
    openRowMenu("Guard");
    expect(view.selection()).toEqual({ tabId: "table-tab", kind: "row", id: "row-1" });

    await choose("Insert row below");

    await waitFor(() => expect(topics(view.lastSaved())).toEqual(["Guard", "", "Mount"]));
    const inserted = view.lastSaved()!.rows[1]!;
    expect(view.selection()).toEqual({ tabId: "table-tab", kind: "row", id: inserted.id });
    view.undo();
    expect(topics(view.lastSaved())).toEqual(["Guard", "Mount"]);
  });

  it("inserts above, duplicates, moves, and deletes a row", async () => {
    const view = renderTable();
    openRowMenu("Mount");
    await choose("Insert row above");
    await waitFor(() => expect(topics(view.lastSaved())).toEqual(["Guard", "", "Mount"]));

    openRowMenu("Mount");
    await choose("Duplicate row");
    await waitFor(() => expect(topics(view.lastSaved())).toEqual(["Guard", "", "Mount", "Mount"]));

    openRowMenu("Guard");
    await choose("Move down");
    await waitFor(() => expect(topics(view.lastSaved())).toEqual(["", "Guard", "Mount", "Mount"]));

    openRowMenu("Guard");
    await choose("Delete row");
    await waitFor(() => expect(topics(view.lastSaved())).toEqual(["", "Mount", "Mount"]));
    expect(view.selection()).toBeNull();

    view.undo();
    expect(topics(view.lastSaved())).toEqual(["", "Guard", "Mount", "Mount"]);
  });

  it("keeps rows from moving past either end or while the view is filtered", async () => {
    renderTable();
    openRowMenu("Guard");
    expect(await isDisabled("Move up")).toBe(true);
    expect(await isDisabled("Move down")).toBe(false);
    fireEvent.keyDown(await menuItem("Move up"), { key: "Escape" });

    fireEvent.change(screen.getByRole("searchbox", { name: "Filter table" }), {
      target: { value: "Mount" },
    });
    openRowMenu("Mount");
    expect(await isDisabled("Move up")).toBe(true);
  });

  it("inserts a column on either side of the right-clicked one", async () => {
    const view = renderTable();
    openColumnMenu();
    await choose("Insert column left");
    await waitFor(() => expect(view.lastSaved()?.columns).toHaveLength(3));
    const left = view.lastSaved()!.columns[0]!.id;
    expect(columnIds(view.lastSaved())).toEqual([left, "topic", "notes"]);
    expect(view.lastSaved()!.rows.every((row) => row.cells[left] === "")).toBe(true);

    view.undo();
    expect(columnIds(view.lastSaved())).toEqual(["topic", "notes"]);
  });

  it("deletes a column, but not a table's last one", async () => {
    const view = renderTable();
    openColumnMenu();
    await choose("Delete column");
    await waitFor(() => expect(columnIds(view.lastSaved())).toEqual(["notes"]));
    view.undo();
    expect(columnIds(view.lastSaved())).toEqual(["topic", "notes"]);

    // A fresh table with one column.
    const single = renderTable({
      initial: { columns: [table.columns[0]!], rows: [{ id: "only", cells: { topic: "Solo" } }] },
    });
    rightClick(screen.getAllByRole("group", { name: "Topic column controls" }).at(-1)!);
    expect(await isDisabled("Delete column")).toBe(true);
    expect(single.savedCount()).toBe(0);
  });

  it("sorts the view without changing the table", async () => {
    const view = renderTable();
    openColumnMenu();
    await choose("Sort Z→A");
    await waitFor(() => expect(shownTopics()).toEqual(["Mount", "Guard"]));
    openColumnMenu();
    await choose("Sort A→Z");
    await waitFor(() => expect(shownTopics()).toEqual(["Guard", "Mount"]));
    expect(view.savedCount()).toBe(0);
  });

  it("opens a column's settings on its name", async () => {
    renderTable();
    openColumnMenu();
    await choose("Column settings…");

    const name = await screen.findByLabelText("Column name");
    expect((name as HTMLInputElement).value).toBe("Topic");
    await waitFor(() => expect(document.activeElement).toBe(name));
  });

  it("offers only sorting in a read-only table, and no menu on its rows", async () => {
    renderTable({ readOnly: true });
    openColumnMenu();
    const items = (await screen.findAllByRole("menuitem")).map((item) => item.textContent);
    expect(items).toEqual(["Sort A→Z", "Sort Z→A"]);
    fireEvent.keyDown(await menuItem("Sort A→Z"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

    openRowMenu("Guard");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("leaves a cell being edited to the native text menu", async () => {
    renderTable();
    fireEvent.doubleClick(screen.getByText("Guard"));
    rightClick(await screen.findByRole("textbox", { name: "Edit Topic" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
