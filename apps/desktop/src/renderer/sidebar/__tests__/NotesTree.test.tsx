// @vitest-environment jsdom

import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  buildNote,
  callsTo,
  dragTreeRow,
  folders,
  hoverTreeRow,
  notes,
  renderSidebar,
  row,
  rootDropStrip,
  stubTreeViewport,
} from "./notesSidebarHarness";

stubTreeViewport();

/** Where the sidebar keeps the folders left open. */
const OPEN_FOLDERS = "loam:notes.sidebar.open-folder-ids";

const rowTitles = () =>
  within(screen.getByRole("navigation", { name: "Notes" }))
    .getAllByRole("button")
    .map((button) => button.textContent);

describe("the notes tree", () => {
  it("lists top-level notes, then folders with their notes hidden", async () => {
    await renderSidebar();

    expect(screen.getByRole("navigation", { name: "Notes" })).toBeTruthy();
    expect(rowTitles()).toEqual(["Root first", "Root later", "Planning", "Archive"]);
  });

  it("expands and collapses a folder", async () => {
    await renderSidebar();
    const folder = row("Planning");

    expect(folder.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(folder);

    expect(folder.getAttribute("aria-expanded")).toBe("true");
    expect(rowTitles()).toEqual([
      "Root first",
      "Root later",
      "Planning",
      "First plan",
      "Second plan",
      "Archive",
    ]);

    fireEvent.click(folder);
    expect(screen.queryByRole("button", { name: "First plan" })).toBeNull();
  });

  it("opens the folders left open last time and remembers changes to them", async () => {
    localStorage.setItem(OPEN_FOLDERS, JSON.stringify(["folder-planning"]));
    await renderSidebar({ activeNoteId: null });

    expect(row("First plan")).toBeTruthy();
    fireEvent.click(row("Planning"));
    fireEvent.click(row("Archive"));

    expect(row("Planning").getAttribute("aria-expanded")).toBe("false");
    expect(JSON.parse(localStorage.getItem(OPEN_FOLDERS)!)).toEqual(["folder-archive"]);
  });

  it("opens the folder of the note that becomes active, and lets it close again", async () => {
    const sidebar = await renderSidebar({ activeNoteId: "root-first" });

    sidebar.openNote("folder-second");
    expect(row("Second plan").getAttribute("aria-current")).toBe("page");

    fireEvent.click(row("Planning"));
    expect(screen.queryByRole("button", { name: "Second plan" })).toBeNull();
  });

  it("shows only the chosen folder, or only unfiled notes", async () => {
    const sidebar = await renderSidebar({ folderScopeId: "folder-planning" });
    expect(rowTitles()).toEqual(["Planning", "First plan", "Second plan"]);

    sidebar.showScope(null);
    expect(rowTitles()).toEqual(["Root first", "Root later"]);

    await sidebar.changeElsewhere({ notes: notes.filter((note) => note.folderId) });
    expect(screen.getByText("No unfiled notes.")).toBeTruthy();
  });

  it("marks the open note", async () => {
    await renderSidebar({ activeNoteId: "root-later" });

    expect(row("Root later").getAttribute("aria-current")).toBe("page");
    expect(row("Root first").getAttribute("aria-current")).toBeNull();
  });

  it("keeps the rows when a note changes without changing the tree", async () => {
    const sidebar = await renderSidebar();
    const first = row("Root first");

    await sidebar.changeElsewhere({
      notes: notes.map((note) =>
        note.id === "root-first" ? { ...note, activeTabId: "another-tab" } : note,
      ),
    });
    expect(row("Root first")).toBe(first);

    await sidebar.changeElsewhere({
      notes: notes.map((note) => (note.id === "root-first" ? { ...note, title: "Renamed" } : note)),
    });
    expect(row("Renamed")).toBeTruthy();
  });
});

describe("dragging in the notes tree", () => {
  it("moves a note into a folder and saves it there, after the folder's notes", async () => {
    const { store } = await renderSidebar();

    await dragTreeRow("Root first", "Planning");

    await waitFor(() =>
      expect(store.titlesIn("folder-planning")).toEqual([
        "First plan",
        "Second plan",
        "Root first",
      ]),
    );
    expect(store.titlesIn(null)).toEqual(["Root later"]);
    expect(store.folderNames()).toEqual(["Planning", "Archive"]);
    // The folder opens to show where the note went.
    expect(row("First plan")).toBeTruthy();
  });

  it("reorders folders without moving notes", async () => {
    const { store } = await renderSidebar();

    await dragTreeRow("Planning", "Archive");

    await waitFor(() => expect(store.folderNames()).toEqual(["Archive", "Planning"]));
    expect(store.titlesIn(null)).toEqual(["Root first", "Root later"]);
    expect(store.titlesIn("folder-planning")).toEqual(["First plan", "Second plan"]);
  });

  it("keeps notes outside the shown folder when reordering inside it", async () => {
    const { store } = await renderSidebar({ folderScopeId: "folder-planning" });

    await dragTreeRow("First plan", "Second plan");

    await waitFor(() =>
      expect(store.titlesIn("folder-planning")).toEqual(["Second plan", "First plan"]),
    );
    expect(store.titlesIn(null)).toEqual(["Root first", "Root later"]);
  });

  it("marks the hovered note, not the top-level drop strip, and drops after it", async () => {
    const { store } = await renderSidebar();
    const { target, drop } = await hoverTreeRow("Root first", "Root later");

    expect(target.getAttribute("data-drop-marker")).toBe("after");
    expect(rootDropStrip().getAttribute("data-drop-marker")).toBeNull();
    await drop();

    await waitFor(() => expect(store.titlesIn(null)).toEqual(["Root later", "Root first"]));
    expect(store.titlesIn("folder-planning")).toEqual(["First plan", "Second plan"]);
  });

  it("moves a note out of its folder through the top-level drop strip", async () => {
    const { store } = await renderSidebar();
    fireEvent.click(row("Planning"));
    const { target, drop } = await hoverTreeRow("First plan", rootDropStrip(), 0);

    expect(target.getAttribute("data-drop-marker")).toBe("before");
    await drop();

    await waitFor(() =>
      expect(store.titlesIn(null)).toEqual(["Root first", "Root later", "First plan"]),
    );
    expect(store.titlesIn("folder-planning")).toEqual(["Second plan"]);
  });

  it("draws a drop after an open folder under its last note", async () => {
    await renderSidebar();
    fireEvent.click(row("Planning"));

    const { target } = await hoverTreeRow("Archive", "Planning");

    expect(row("Second plan").getAttribute("data-drop-marker")).toBe("after");
    expect(target.getAttribute("data-drop-marker")).toBeNull();
  });

  it("clears the drop line when the drag ends", async () => {
    await renderSidebar();
    const { target } = await hoverTreeRow("Planning", "Archive");
    expect(target.getAttribute("data-drop-marker")).toBe("after");

    await act(async () => {
      fireEvent.dragEnd(row("Planning"));
    });
    expect(target.getAttribute("data-drop-marker")).toBeNull();
  });

  it("clears the drop underline when the dragged folder disappears", async () => {
    const sidebar = await renderSidebar();
    const { target } = await hoverTreeRow("Planning", "Archive");
    expect(target.getAttribute("data-drop-marker")).toBe("after");

    await sidebar.changeElsewhere({
      folders: folders.filter((folder) => folder.id !== "folder-planning"),
    });
    expect(screen.queryByRole("button", { name: "Planning" })).toBeNull();
    expect(row("Archive").getAttribute("data-drop-marker")).toBeNull();
  });

  it("does not drop a folder onto a note", async () => {
    const { invoke } = await renderSidebar();
    fireEvent.click(row("Planning"));

    await dragTreeRow("Archive", "First plan");

    expect(callsTo(invoke, "notes.saveLayout")).toEqual([]);
  });
});

describe("a library too large to render at once", () => {
  const manyNotes = Array.from({ length: 150 }, (_, index) =>
    buildNote({ id: `note-${index}`, title: `Note ${index}`, position: index }),
  );
  const renderLarge = () => renderSidebar({ notes: manyNotes, folders: [], activeNoteId: null });

  it("shows the rows in view and the rest when scrolled to", async () => {
    await renderLarge();

    expect(row("Note 0")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Note 149" })).toBeNull();

    const body = screen.getByRole("group", { name: "Notes tree selection area" });
    body.scrollTop = 150 * 30;
    fireEvent.scroll(body);

    expect(await screen.findByRole("button", { name: "Note 149" })).toBeTruthy();
  });

  it("deletes a selected note from the keyboard", async () => {
    const { store } = await renderLarge();

    fireEvent.click(row("Note 3"));
    fireEvent.keyDown(row("Note 3"), { key: "Delete" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete note" }));
    });

    await waitFor(() => expect(store.inTrash("note-3")).toBe(true));
    expect(screen.queryByRole("button", { name: "Note 3" })).toBeNull();
  });

  it("reorders notes by dragging", async () => {
    const { store } = await renderLarge();

    await dragTreeRow("Note 0", "Note 2");

    await waitFor(() =>
      expect(store.titlesIn(null).slice(0, 4)).toEqual(["Note 1", "Note 2", "Note 0", "Note 3"]),
    );
  });
});
