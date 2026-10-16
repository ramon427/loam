// @vitest-environment jsdom

import { act, createEvent, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { LoamBridgeParams } from "@loam/shared/bridge/loamBridge";

import {
  callsTo,
  clickMenuItem,
  deferred,
  isSelected,
  notes,
  openTreeMenu,
  renderSidebar,
  row,
  stubTreeViewport,
} from "./notesSidebarHarness";

stubTreeViewport();

const pointer = (type: "pointerDown" | "pointerMove" | "pointerUp", x: number, y: number) =>
  fireEvent[type](screen.getByRole("group", { name: "Notes tree selection area" }), {
    button: 0,
    pointerId: 1,
    clientX: x,
    clientY: y,
  });

describe("selecting in the notes tree", () => {
  it("opens a note on click, and the selection follows the open note", async () => {
    const sidebar = await renderSidebar();

    fireEvent.click(row("Root later"));
    expect(sidebar.activeNoteId()).toBe("root-later");

    expect(row("Root later").getAttribute("aria-current")).toBe("page");
    expect(isSelected("Root later")).toBe(true);
    expect(isSelected("Root first")).toBe(false);
  });

  it("adds a note with Ctrl/Cmd without opening it", async () => {
    const sidebar = await renderSidebar();

    fireEvent.click(row("Root later"), { metaKey: true });

    expect(sidebar.activeNoteId()).toBe("root-first");
    expect(isSelected("Root later")).toBe(true);
  });

  it("selects a range of shown rows with Shift", async () => {
    await renderSidebar();

    fireEvent.click(row("Root first"));
    fireEvent.click(row("Planning"), { shiftKey: true });

    expect(isSelected("Root later")).toBe(true);
    expect(isSelected("Planning")).toBe(true);
    expect(isSelected("Archive")).toBe(false);
  });

  it("follows the open note while one note is selected", async () => {
    const sidebar = await renderSidebar({ activeNoteId: "root-first" });

    sidebar.openNote("root-later");

    expect(isSelected("Root later")).toBe(true);
    expect(isSelected("Root first")).toBe(false);
  });

  it("selects the rows a rectangle dragged over empty space touches", async () => {
    await renderSidebar();
    const body = screen.getByRole("group", { name: "Notes tree selection area" });
    body.getBoundingClientRect = () => new DOMRect(0, 0, 300, 300);

    // Rows are 30px tall: Root first, Root later, a 16px drop strip, then Planning at 76.
    pointer("pointerDown", 2, 2);
    pointer("pointerMove", 250, 70);
    pointer("pointerUp", 250, 70);

    expect(isSelected("Root later")).toBe(true);
    expect(isSelected("Planning")).toBe(false);
  });

  it("clears the selection on a click in empty space", async () => {
    await renderSidebar({ activeNoteId: null });
    fireEvent.click(row("Planning"));

    pointer("pointerDown", 5, 280);
    pointer("pointerUp", 5, 280);

    expect(isSelected("Planning")).toBe(false);
  });

  it("leaves buttons in the empty tree to their clicks", async () => {
    await renderSidebar({ activeNoteId: null, notes: [], folders: [] });
    const button = screen.getByRole("button", { name: "New note" });
    const event = createEvent.pointerDown(button, { button: 0, pointerId: 1, bubbles: true });

    fireEvent(button, event);

    expect(event.defaultPrevented).toBe(false);
  });

  it("keeps a right-clicked multi-selection and offers bulk actions only", async () => {
    await renderSidebar();
    const [first, later] = [row("Root first"), row("Root later")];
    fireEvent.click(first);
    fireEvent.click(later, { shiftKey: true });

    openTreeMenu(first);

    expect(await screen.findByRole("menuitem", { name: "Delete selected" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Select all" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Rename note" })).toBeNull();
    expect(first.getAttribute("aria-pressed")).toBe("true");
    expect(later.getAttribute("aria-pressed")).toBe("true");
  });

  it("selects only a right-clicked item outside the selection", async () => {
    await renderSidebar({ activeNoteId: null });
    const [first, folder] = [row("Root first"), row("Planning")];
    fireEvent.click(first);

    openTreeMenu(folder);

    expect(await screen.findByRole("menuitem", { name: "Delete folder" })).toBeTruthy();
    expect(first.getAttribute("aria-pressed")).toBe("false");
    expect(folder.getAttribute("aria-pressed")).toBe("true");
  });

  it("acts on the whole selection when the right-clicked row is part of it", async () => {
    await renderSidebar();
    fireEvent.click(row("Root first"));
    fireEvent.click(row("Root later"), { shiftKey: true });

    openTreeMenu(row("Root later"));

    expect(await screen.findByRole("menuitem", { name: "Delete selected" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Rename note" })).toBeNull();
  });

  it("leaves a right-click in the rename field to the native menu", async () => {
    await renderSidebar();
    openTreeMenu(row("Root first"));
    await clickMenuItem("Rename note");
    const field = screen.getByLabelText("Rename note");
    const event = createEvent.contextMenu(field, { bubbles: true, cancelable: true });

    fireEvent(field, event);

    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("deleting the selection from the keyboard", () => {
  it("deletes the selected notes together, without asking", async () => {
    const { store } = await renderSidebar();
    fireEvent.click(row("Root first"));
    fireEvent.click(row("Root later"), { shiftKey: true });

    fireEvent.keyDown(row("Root later"), { key: "Delete" });

    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(store.titlesIn(null)).toEqual([]));
    expect(store.inTrash("root-first") && store.inTrash("root-later")).toBe(true);
    expect(store.folderNames()).toEqual(["Planning", "Archive"]);
  });

  it("deletes a selected folder, not the notes hidden inside it", async () => {
    const { store } = await renderSidebar();
    fireEvent.click(row("Planning"));

    fireEvent.keyDown(row("Planning"), { key: "Backspace" });
    expect(screen.getByRole("heading", { name: "Delete folder?" })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete folder" }));
    });

    await waitFor(() => expect(store.folderNames()).toEqual(["Archive"]));
    // Its notes stay, at the top level.
    expect(store.titlesIn(null).sort()).toEqual([
      "First plan",
      "Root first",
      "Root later",
      "Second plan",
    ]);
  });

  it("deletes the note that is open after it changed", async () => {
    const sidebar = await renderSidebar({ activeNoteId: "root-first" });
    sidebar.openNote("root-later");

    fireEvent.keyDown(row("Root later"), { key: "Delete" });

    await waitFor(() => expect(sidebar.store.inTrash("root-later")).toBe(true));
    expect(sidebar.store.note("root-first")).toBeDefined();
  });

  it("does nothing for the open note while the folder filter hides it", async () => {
    await renderSidebar({ folderScopeId: "folder-planning" });

    fireEvent.keyDown(screen.getByRole("navigation", { name: "Notes" }), { key: "Delete" });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not delete while a name is being typed", async () => {
    const sidebar = await renderSidebar();
    openTreeMenu(row("Root first"));
    await clickMenuItem("Rename note");

    await act(async () => {
      fireEvent.keyDown(screen.getByLabelText("Rename note"), { key: "Delete" });
    });

    expect(callsTo(sidebar.invoke, "notes.delete")).toEqual([]);
  });

  it("keeps a selection made while a delete is still running", async () => {
    const remove = deferred();
    const sidebar = await renderSidebar({
      handlers: (store) => ({
        "notes.delete": async (params: LoamBridgeParams<"notes.delete">) => {
          await remove.promise;
          return store.answers["notes.delete"](params);
        },
      }),
    });

    await act(async () => {
      fireEvent.keyDown(row("Root first"), { key: "Delete" });
    });
    // The tree can still change while the delete runs.
    fireEvent.click(screen.getByRole("button", { name: "Planning", hidden: true }));
    await sidebar.changeElsewhere({ notes: notes.filter((note) => note.id !== "root-later") });
    await act(async () => remove.resolve());
    await waitFor(() => expect(callsTo(sidebar.invoke, "notes.delete")).toHaveLength(1));

    expect(
      screen.getByRole("button", { name: "Planning", hidden: true }).getAttribute("aria-pressed"),
    ).toBe("true");
  });
});
