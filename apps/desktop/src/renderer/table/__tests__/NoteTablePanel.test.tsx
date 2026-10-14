// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import type { TabHistoryCommands } from "../../note/useTypedTabHistory";

import { NoteTablePanel, type NoteTableSelection } from "../NoteTablePanel";
import { createNoteTable } from "../noteTable";

type PanelProps = ComponentProps<typeof NoteTablePanel>;

const panelProps = (overrides: Partial<PanelProps> = {}): PanelProps => ({
  tab: { id: "table-tab", title: "Table", kind: "table" },
  table: createNoteTable({ title: "Topic" }),
  selectedTarget: null,
  readOnly: false,
  onSelectTarget: vi.fn(),
  onUpdateTable: vi.fn(),
  headingOptions: [],
  onToggleHeadingConnection: vi.fn(),
  onOpenHeading: vi.fn(),
  ...overrides,
});

const renderPanel = (overrides: Partial<PanelProps> = {}) =>
  render(<NoteTablePanel {...panelProps(overrides)} />);

describe("NoteTablePanel", () => {
  it("keeps a filter that excludes the selected row and clears the hidden selection", async () => {
    const table = createNoteTable({ title: "Selected topic" });
    const selectedRowId = table.rows[0]!.id;
    const onSelectTarget = vi.fn();

    function Harness() {
      const [selectedTarget, setSelectedTarget] = useState<NoteTableSelection | null>({
        tabId: "table-tab",
        kind: "row",
        id: selectedRowId,
      });
      return (
        <NoteTablePanel
          {...panelProps({ table, selectedTarget })}
          onSelectTarget={(target) => {
            onSelectTarget(target);
            setSelectedTarget(target);
          }}
        />
      );
    }

    render(<Harness />);
    const filter = screen.getByRole("searchbox", { name: "Filter table" }) as HTMLInputElement;
    fireEvent.change(filter, { target: { value: "absent-row" } });

    await waitFor(() => expect(onSelectTarget).toHaveBeenCalledWith(null));
    expect(filter.value).toBe("absent-row");
    expect(screen.queryByText("Selected topic")).toBeNull();
  });

  it("duplicates the selected row while the table is filtered", () => {
    const table = createNoteTable({ title: "Selected topic" });
    const selectedRowId = table.rows[0]!.id;
    const onUpdateTable = vi.fn();

    renderPanel({
      table,
      selectedTarget: { tabId: "table-tab", kind: "row", id: selectedRowId },
      onUpdateTable,
    });
    fireEvent.change(screen.getByRole("searchbox", { name: "Filter table" }), {
      target: { value: "Selected" },
    });

    expect((screen.getByTitle("Move row up") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTitle("Duplicate row"));

    const committed = onUpdateTable.mock.calls.at(-1)?.[0] as ReturnType<typeof createNoteTable>;
    expect(committed.rows).toHaveLength(2);
  });

  it("focuses the text editor opened by double-clicking a cell", async () => {
    const table = createNoteTable({ title: "Focus topic" });

    renderPanel({ table });
    fireEvent.doubleClick(screen.getByText("Focus topic"));

    const editor = await screen.findByRole("textbox", { name: /^Edit / });
    expect(document.activeElement).toBe(editor);
  });

  it("commits the option chosen in a Select cell editor", async () => {
    const base = createNoteTable({ title: "Select topic" });
    // The first column: jsdom has no layout, so the grid renders only one column.
    const statusColumn = base.columns[0]!;
    const table = {
      ...base,
      columns: base.columns.map((column) =>
        column.id === statusColumn.id
          ? { ...column, type: "select" as const, options: [{ id: "open", label: "Open" }] }
          : column,
      ),
      rows: base.rows.map((row) => ({ ...row, cells: { ...row.cells, [statusColumn.id]: "" } })),
    };
    const onUpdateTable = vi.fn();
    // The grid refocuses the cell after a commit; jsdom lacks scrollIntoView.
    Element.prototype.scrollIntoView ??= vi.fn();

    renderPanel({ table, onUpdateTable });
    const statusCell = screen
      .getAllByRole("gridcell")
      .find((cell) => cell.getAttribute("aria-colindex") === "2");
    if (!statusCell) throw new Error("Expected the status cell to render");
    fireEvent.doubleClick(statusCell);
    const trigger = await screen.findByRole("combobox", { name: `Edit ${statusColumn.title}` });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(await screen.findByRole("option", { name: "Open" }), { key: "Enter" });

    await waitFor(() => {
      const committed = onUpdateTable.mock.calls.at(-1)?.[0] as typeof table | undefined;
      expect(committed?.rows[0]?.cells[statusColumn.id]).toBe("open");
    });
  });

  const statusTable = (cellValue: string) => {
    const base = createNoteTable({ title: "Status topic" });
    // The first column: jsdom has no layout, so the grid renders only one column.
    const statusId = base.columns[0]!.id;
    return {
      statusId,
      table: {
        ...base,
        columns: base.columns.map((column) =>
          column.id === statusId
            ? {
                ...column,
                title: "Status",
                type: "select" as const,
                options: [
                  { id: "choice-1", label: "Done" },
                  { id: "choice-2", label: "Open" },
                ],
              }
            : column,
        ),
        rows: base.rows.map((row) => ({ ...row, cells: { ...row.cells, [statusId]: cellValue } })),
      },
    };
  };
  const gridCellTexts = () => screen.getAllByRole("gridcell").map((cell) => cell.textContent);

  it("keeps a choice on its cells while the choice is renamed", () => {
    const { statusId, table } = statusTable("choice-1");
    renderPanel({ table, selectedTarget: { tabId: "table-tab", kind: "column", id: statusId } });
    const choices = screen.getByLabelText("Choices, comma separated");

    for (const text of ["Don, Open", ", Open", "Completed, Open"]) {
      fireEvent.change(choices, { target: { value: text } });
    }

    expect(gridCellTexts()).toContain("Completed");
  });

  it("filters select cells by the choice they show", () => {
    const { table } = statusTable("choice-1");
    renderPanel({ table });

    fireEvent.change(screen.getByRole("searchbox", { name: "Filter table" }), {
      target: { value: "done" },
    });

    expect(gridCellTexts()).toContain("Done");
  });

  it("keeps undo for a cell edit followed at once by a click elsewhere", async () => {
    const initial = createNoteTable({ title: "Before" });
    const historyBridgeRef: { current: TabHistoryCommands | null } = { current: null };
    // The grid refocuses the cell after a commit; jsdom lacks scrollIntoView.
    Element.prototype.scrollIntoView ??= vi.fn();

    function Harness() {
      const [table, setTable] = useState(initial);
      const [selectedTarget, setSelectedTarget] = useState<NoteTableSelection | null>(null);
      return (
        <NoteTablePanel
          {...panelProps({ table, selectedTarget, historyBridgeRef })}
          onSelectTarget={setSelectedTarget}
          // A new callback on every render, as the note view passes it.
          onUpdateTable={(next) => setTable(next)}
        />
      );
    }

    render(<Harness />);
    fireEvent.doubleClick(screen.getByText("Before"));
    const editor = await screen.findByRole("textbox", { name: /^Edit / });
    fireEvent.change(editor, { target: { value: "After" } });
    fireEvent.keyDown(editor, { key: "Enter" });
    fireEvent.click(screen.getByRole("group", { name: "Topic column controls" }));
    expect(screen.getByText("After")).toBeTruthy();

    act(() => {
      historyBridgeRef.current?.undo();
    });

    expect(screen.getByText("Before")).toBeTruthy();
  });

  it("saves typing in a column name at once and undoes the burst as one step", () => {
    const initial = createNoteTable({ title: "Topic row" });
    const columnId = initial.columns[0]!.id;
    const historyBridgeRef: { current: TabHistoryCommands | null } = { current: null };
    const saved: string[] = [];

    function Harness() {
      const [table, setTable] = useState(initial);
      return (
        <NoteTablePanel
          {...panelProps({
            table,
            selectedTarget: { tabId: "table-tab", kind: "column", id: columnId },
            historyBridgeRef,
          })}
          onUpdateTable={(next) => {
            saved.push(next.columns[0]!.title);
            setTable(next);
          }}
        />
      );
    }

    render(<Harness />);
    const name = screen.getByLabelText("Column name");
    fireEvent.change(name, { target: { value: "Top" } });
    fireEvent.change(name, { target: { value: "Topics" } });
    expect(saved).toEqual(["Top", "Topics"]);

    act(() => {
      historyBridgeRef.current?.undo();
    });

    expect((screen.getByLabelText("Column name") as HTMLInputElement).value).toBe("Topic");
  });
});
