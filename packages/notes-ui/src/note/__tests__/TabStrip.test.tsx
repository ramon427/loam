// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { NoteDocument } from "../../workspace/types";
import { configureNotesHost } from "../../host/notesHost";
import { TabStrip } from "../TabStrip";

const paragraph = (text: string) => ({
  id: `p-${text}`,
  type: "paragraph" as const,
  content: [{ type: "text" as const, text, styles: {} }],
  children: [],
});

const note: NoteDocument = {
  id: "note",
  title: "Plan",
  updatedAt: "2026-10-13T00:00:00.000Z",
  activeTabId: "written",
  tabs: [
    { id: "written", title: "Written", kind: "page" },
    { id: "empty", title: "Empty", kind: "page" },
  ],
  blocksByTab: { written: [paragraph("Some words")], empty: [] },
  graphsByTab: {},
  tablesByTab: {},
};

const renderStrip = () => {
  const actions = {
    onSelect: vi.fn(),
    onAdd: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onChangeKind: vi.fn(),
    onMove: vi.fn(),
  };
  render(<TabStrip note={note} activeTabId="written" {...actions} />);
  return actions;
};

const openTabMenu = (title: string) =>
  fireEvent.contextMenu(screen.getByRole("button", { name: title }), { clientX: 10, clientY: 10 });

const chooseMenuItem = async (name: string) =>
  fireEvent.click(await screen.findByRole("menuitem", { name }));

describe("TabStrip", () => {
  it("deletes a tab with content only after asking", async () => {
    const { onDelete } = renderStrip();
    openTabMenu("Written");
    await chooseMenuItem("Delete tab");

    const dialog = await screen.findByRole("dialog", { name: "Delete editor tab?" });
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete editor tab" }));
    expect(onDelete).toHaveBeenCalledWith("written");
  });

  it("deletes an empty tab at once", async () => {
    const { onDelete } = renderStrip();
    openTabMenu("Empty");
    await chooseMenuItem("Delete tab");

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("empty"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("changes an empty tab's kind at once, and asks before wiping one with content", async () => {
    const { onChangeKind } = renderStrip();
    openTabMenu("Empty");
    await chooseMenuItem("Change type");
    await chooseMenuItem("Graph");
    await waitFor(() => expect(onChangeKind).toHaveBeenCalledWith("empty", "graph"));

    openTabMenu("Written");
    await chooseMenuItem("Change type");
    await chooseMenuItem("Table");
    const dialog = await screen.findByRole("dialog", { name: "Convert to a table tab?" });
    expect(within(dialog).getByText(/Each heading becomes a row/)).toBeTruthy();
    expect(onChangeKind).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Convert to table tab" }));
    expect(onChangeKind).toHaveBeenLastCalledWith("written", "table");
  });

  it("adds a tab of the kind picked in the add menu, by click or number key", async () => {
    const { onAdd } = renderStrip();
    fireEvent.keyDown(screen.getByRole("button", { name: "Add tab" }), { key: "Enter" });
    await chooseMenuItem("Table tab");
    expect(onAdd).toHaveBeenLastCalledWith("table");

    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    fireEvent.keyDown(screen.getByRole("button", { name: "Add tab" }), { key: "Enter" });
    fireEvent.keyDown(await screen.findByRole("menuitem", { name: "Page tab" }), { key: "2" });
    expect(onAdd).toHaveBeenLastCalledWith("graph");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("offers file tabs only where the host opens files", async () => {
    configureNotesHost({ invoke: vi.fn(), on: () => () => {}, capabilities: { files: false } });
    try {
      const { onAdd } = renderStrip();
      fireEvent.keyDown(screen.getByRole("button", { name: "Add tab" }), { key: "Enter" });
      const menu = await screen.findByRole("menu");
      const items = within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.getAttribute("aria-label"));
      expect(items).toEqual(["Page tab", "Graph tab", "Table tab", "Board tab", "Embed tab"]);
      // The number keys follow the kinds offered.
      fireEvent.keyDown(within(menu).getByRole("menuitem", { name: "Page tab" }), { key: "5" });
      expect(onAdd).toHaveBeenLastCalledWith("embed");
    } finally {
      configureNotesHost({ invoke: vi.fn(), on: () => () => {} });
    }
  });

  it("moves a tab past its neighbor at once", async () => {
    const { onMove } = renderStrip();
    openTabMenu("Written");
    const moveLeft = await screen.findByRole("menuitem", { name: "Move left" });
    expect(moveLeft.getAttribute("aria-disabled")).toBe("true");
    await chooseMenuItem("Move right");

    await waitFor(() => expect(onMove).toHaveBeenCalledWith("written", "empty", "after"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
