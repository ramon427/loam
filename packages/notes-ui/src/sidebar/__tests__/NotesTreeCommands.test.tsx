// @vitest-environment jsdom

import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { LoamBridgeParams } from "@loam/shared/bridge/loamBridge";

import { stubClipboard } from "../../testing/clipboard";
import type { NoteDocument } from "../../workspace/types";

import { NotesSidebarCreateActions } from "../NotesSidebarCreateActions";
import { useNotesTreeCommands } from "../useNotesTreeCommands";
import {
  buildNote,
  callsTo,
  clickMenuItem,
  deferred,
  movePlace,
  moveTo,
  notes,
  openTreeMenu,
  REDO,
  renderSidebar,
  row,
  stubTreeViewport,
  typeName,
  UNDO,
} from "./notesSidebarHarness";

stubTreeViewport();

function ForgetHistoryButton() {
  const { forgetHistory } = useNotesTreeCommands();
  return (
    <button type="button" onClick={forgetHistory}>
      Forget
    </button>
  );
}

/** A title the window saves after a short pause. */
const SAVE_PAUSE = { timeout: 3000 };

/** The notes created in a folder (null: the top level), untitled as new notes are. */
const untitledIn = (titles: string[]) => titles.filter((title) => title === "");

describe("creating notes and folders", () => {
  it("offers New note and New folder in an empty library", async () => {
    const { store } = await renderSidebar({ activeNoteId: null, notes: [], folders: [] });

    expect(screen.getByText("Create your first note")).toBeTruthy();
    fireEvent.click(row("New folder"));
    expect(await screen.findByLabelText("Folder name")).toBeTruthy();
    await typeName("Folder name", "", "Escape");

    await act(async () => {
      fireEvent.click(row("New note"));
    });
    await waitFor(() => expect(store.titlesIn(null)).toEqual([""]));
  });

  it("creates from the sidebar header buttons", async () => {
    const { store } = await renderSidebar({
      extra: <NotesSidebarCreateActions folderId="folder-planning" />,
    });
    const header = within(screen.getByRole("group", { name: "Create in Notes" }));

    await act(async () => {
      fireEvent.click(header.getByRole("button", { name: "New note" }));
    });
    await waitFor(() =>
      expect(store.titlesIn("folder-planning")).toEqual(["First plan", "Second plan", ""]),
    );

    fireEvent.click(header.getByRole("button", { name: "New folder" }));
    // The field appears where the folder will be added: after the existing ones.
    const field = screen.getByLabelText("Folder name");
    expect(row("Archive").compareDocumentPosition(field)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("keeps New note on the header's outer edge, whichever side the buttons are on", async () => {
    await renderSidebar({
      extra: (
        <>
          <NotesSidebarCreateActions />
          <NotesSidebarCreateActions align="start" />
        </>
      ),
    });
    const [end, start] = screen.getAllByRole("group", { name: "Create in Notes" }).map((group) =>
      within(group)
        .getAllByRole("button")
        .map((button) => button.title),
    );

    expect(end).toEqual(["New project", "New folder", "New note"]);
    expect(start).toEqual(["New note", "New folder", "New project"]);
  });

  it("creates one note while a create is still running", async () => {
    const create = deferred();
    const { invoke, store } = await renderSidebar({
      extra: <NotesSidebarCreateActions />,
      handlers: (store) => ({
        "notes.create": async (params: LoamBridgeParams<"notes.create">) => {
          await create.promise;
          return store.answers["notes.create"](params);
        },
      }),
    });
    const newNote = () =>
      within(screen.getByRole("group", { name: "Create in Notes" })).getByRole("button", {
        name: "New note",
      });

    await act(async () => {
      fireEvent.click(newNote());
      fireEvent.click(newNote());
    });
    expect(callsTo(invoke, "notes.create")).toHaveLength(1);

    await act(async () => create.resolve());
    await act(async () => {
      fireEvent.click(newNote());
    });
    await waitFor(() => expect(untitledIn(store.titlesIn(null))).toHaveLength(2));
  });

  it("creates a note at the top level or in a right-clicked folder", async () => {
    const { store } = await renderSidebar();

    openTreeMenu();
    expect(screen.getByRole("menuitem", { name: "Undo" })).toBeTruthy();
    await clickMenuItem("New note");
    await waitFor(() => expect(store.titlesIn(null)).toEqual(["Root first", "Root later", ""]));

    openTreeMenu(row("Planning"));
    await clickMenuItem("New note");
    await waitFor(() =>
      expect(store.titlesIn("folder-planning")).toEqual(["First plan", "Second plan", ""]),
    );
    expect(row("First plan")).toBeTruthy();
  });

  it("names a new folder in place, or cancels it", async () => {
    const { store } = await renderSidebar();

    openTreeMenu();
    await clickMenuItem("New folder");
    await typeName("Folder name", "Research");
    await waitFor(() => expect(store.folderNames()).toEqual(["Planning", "Archive", "Research"]));

    openTreeMenu();
    await clickMenuItem("New folder");
    await typeName("Folder name", "Canceled", "Escape");
    expect(store.folderNames()).toEqual(["Planning", "Archive", "Research"]);
    expect(screen.queryByLabelText("Folder name")).toBeNull();
  });

  it("keeps a name typed in place when focus leaves the field", async () => {
    const { store } = await renderSidebar();

    openTreeMenu();
    await clickMenuItem("New folder");
    const field = screen.getByLabelText("Folder name");
    expect(field).toHaveProperty("value", "New folder");
    fireEvent.change(field, { target: { value: "Clicked away" } });
    await act(async () => {
      fireEvent.blur(field);
    });
    await waitFor(() =>
      expect(store.folderNames()).toEqual(["Planning", "Archive", "Clicked away"]),
    );

    openTreeMenu(row("Root first"));
    await clickMenuItem("Rename note");
    const title = screen.getByLabelText("Rename note");
    fireEvent.change(title, { target: { value: "Renamed by blur" } });
    await act(async () => {
      fireEvent.blur(title);
    });
    await waitFor(() => expect(row("Renamed by blur")).toBeTruthy());
  });
});

describe("renaming", () => {
  it("renames a note once, however often Enter is pressed, and cancels with Escape", async () => {
    const { invoke, store } = await renderSidebar();

    openTreeMenu(row("Root first"));
    await clickMenuItem("Rename note");
    const input = screen.getByLabelText("Rename note");
    fireEvent.change(input, { target: { value: "Updated root" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(row("Updated root")).toBeTruthy();
    await waitFor(() => expect(store.note("root-first")?.title).toBe("Updated root"), SAVE_PAUSE);
    expect(callsTo(invoke, "notes.save")).toHaveLength(1);

    openTreeMenu(row("Root later"));
    await clickMenuItem("Rename note");
    await typeName("Rename note", "Canceled", "Escape");
    expect(row("Root later")).toBeTruthy();
  });

  it("renames a folder in place, trimmed, without moving anything", async () => {
    const { store } = await renderSidebar();
    fireEvent.click(row("Planning"));

    openTreeMenu(row("Planning"));
    await clickMenuItem("Rename folder");
    expect((screen.getByLabelText("Rename folder") as HTMLInputElement).value).toBe("Planning");
    expect(row("First plan")).toBeTruthy();
    await typeName("Rename folder", "  Playbooks  ");

    await waitFor(() => expect(store.folderNames()).toEqual(["Playbooks", "Archive"]));
    expect(store.titlesIn(null)).toEqual(["Root first", "Root later"]);
    expect(store.titlesIn("folder-planning")).toEqual(["First plan", "Second plan"]);
    expect(screen.queryByLabelText("Rename folder")).toBeNull();
  });

  it("keeps a folder's name when the rename is canceled, cleared, or unchanged", async () => {
    const { invoke } = await renderSidebar();
    for (const [value, key] of [
      ["Canceled", "Escape"],
      ["   ", "Enter"],
      ["Planning", "Enter"],
    ] as const) {
      openTreeMenu(row("Planning"));
      await clickMenuItem("Rename folder");
      await typeName("Rename folder", value, key);
    }

    expect(callsTo(invoke, "notes.saveLayout")).toEqual([]);
    expect(row("Planning")).toBeTruthy();
  });
});

describe("deleting", () => {
  it("moves a note to Trash without asking", async () => {
    const { store } = await renderSidebar();

    openTreeMenu(row("Root first"));
    await clickMenuItem("Delete note");

    await waitFor(() => expect(store.inTrash("root-first")).toBe(true));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("undo and redo", () => {
  const undoRedo = async (undo: string, redo: string) => {
    openTreeMenu();
    await clickMenuItem(undo);
    openTreeMenu();
    await clickMenuItem(redo);
  };

  /** The id of the note the last New note created. */
  const createdNoteId = (invoke: { mock: { calls: unknown[][] } }) =>
    (callsTo(invoke, "notes.create").at(-1)![1] as LoamBridgeParams<"notes.create">).note.id;

  it("undoes and redoes a new note", async () => {
    const { invoke, store } = await renderSidebar();
    openTreeMenu();
    await clickMenuItem("New note");
    const created = createdNoteId(invoke);

    openTreeMenu();
    await clickMenuItem("Undo new note");
    await waitFor(() => expect(store.inTrash(created)).toBe(true));
    openTreeMenu();
    await clickMenuItem("Redo new note");

    await waitFor(() => expect(store.note(created)).toBeDefined());
  });

  it("offers Redo at once after undoing a new note, and redoes once the delete settles", async () => {
    const remove = deferred();
    const { invoke, store } = await renderSidebar({
      handlers: (store) => ({
        "notes.delete": async (params: LoamBridgeParams<"notes.delete">) => {
          await remove.promise;
          return store.answers["notes.delete"](params);
        },
      }),
    });
    openTreeMenu();
    await clickMenuItem("New note");
    const created = createdNoteId(invoke);
    openTreeMenu();
    await clickMenuItem("Undo new note");

    openTreeMenu();
    const redo = await screen.findByRole("menuitem", { name: "Redo new note" });
    expect(redo.hasAttribute("data-disabled")).toBe(false);
    await clickMenuItem("Redo new note");
    expect(callsTo(invoke, "notes.restore")).toEqual([]);

    await act(async () => remove.resolve());
    await waitFor(() => expect(callsTo(invoke, "notes.restore")).toHaveLength(1));
    await waitFor(() => expect(store.note(created)).toBeDefined());
  });

  it("does not restore a pending Redo after the sidebar is gone", async () => {
    const remove = deferred();
    const sidebar = await renderSidebar({
      handlers: (store) => ({
        "notes.delete": async (params: LoamBridgeParams<"notes.delete">) => {
          await remove.promise;
          return store.answers["notes.delete"](params);
        },
      }),
    });
    openTreeMenu();
    await clickMenuItem("New note");
    await undoRedo("Undo new note", "Redo new note");

    sidebar.unmount();
    await act(async () => remove.resolve());

    expect(callsTo(sidebar.invoke, "notes.restore")).toEqual([]);
  });

  it("ends every menu with Undo and Redo after a separator", async () => {
    await renderSidebar();
    const menuEnd = () => {
      const menu = screen.getByRole("menu");
      const children = [...menu.children];
      return children
        .slice(-3)
        .map((child) =>
          child.getAttribute("role") === "separator" ? "---" : child.textContent?.trim(),
        );
    };
    const expected = ["---", `Undo${UNDO}`, `Redo${REDO}`];

    for (const target of [undefined, row("Root first"), row("Planning")]) {
      openTreeMenu(target);
      await screen.findByRole("menu");
      expect(menuEnd()).toEqual(expected);
      fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    }
    fireEvent.click(row("Root first"));
    fireEvent.click(row("Root later"), { shiftKey: true });
    openTreeMenu(row("Root later"));
    await screen.findByRole("menu");
    expect(menuEnd()).toEqual(expected);
  });

  it("undoes and redoes with the keyboard in the tree, but not in a name field", async () => {
    const { store } = await renderSidebar();
    openTreeMenu(row("Root first"));
    await clickMenuItem("Rename note");
    await typeName("Rename note", "Updated root");
    expect(row("Updated root")).toBeTruthy();

    openTreeMenu(row("Planning"));
    await clickMenuItem("Rename folder");
    fireEvent.keyDown(screen.getByLabelText("Rename folder"), { key: "z", ctrlKey: true });
    expect(row("Updated root")).toBeTruthy();
    await typeName("Rename folder", "Planning", "Escape");

    await act(async () => {
      fireEvent.keyDown(row("Updated root"), { key: "z", ctrlKey: true });
    });
    await waitFor(() => expect(row("Root first")).toBeTruthy());
    await act(async () => {
      fireEvent.keyDown(row("Root first"), { key: "Z", ctrlKey: true, shiftKey: true });
    });
    await waitFor(() => expect(row("Updated root")).toBeTruthy());
    await waitFor(() => expect(store.note("root-first")?.title).toBe("Updated root"), SAVE_PAUSE);
  });

  it("undoes and redoes a new folder", async () => {
    const { store } = await renderSidebar();
    openTreeMenu();
    await clickMenuItem("New folder");
    await typeName("Folder name", "Research");
    await waitFor(() => expect(store.folderNames()).toContain("Research"));

    openTreeMenu();
    await clickMenuItem("Undo new folder");
    await waitFor(() => expect(store.folderNames()).toEqual(["Planning", "Archive"]));
    openTreeMenu();
    await clickMenuItem("Redo new folder");
    await waitFor(() => expect(store.folderNames()).toEqual(["Planning", "Archive", "Research"]));
  });

  it("undoes and redoes renames", async () => {
    const { store } = await renderSidebar();
    openTreeMenu(row("Root first"));
    await clickMenuItem("Rename note");
    await typeName("Rename note", "Updated root");
    openTreeMenu(row("Planning"));
    await clickMenuItem("Rename folder");
    await typeName("Rename folder", "Playbooks");
    await waitFor(() => expect(store.folderNames()[0]).toBe("Playbooks"));

    openTreeMenu();
    await clickMenuItem("Undo rename folder");
    await waitFor(() => expect(store.folderNames()[0]).toBe("Planning"));
    openTreeMenu();
    await clickMenuItem("Redo rename folder");
    await waitFor(() => expect(store.folderNames()[0]).toBe("Playbooks"));

    openTreeMenu();
    await clickMenuItem("Undo rename folder");
    openTreeMenu();
    await clickMenuItem("Undo rename note");
    expect(row("Root first")).toBeTruthy();
    openTreeMenu();
    await clickMenuItem("Redo rename note");
    expect(row("Updated root")).toBeTruthy();
    await waitFor(() => expect(store.note("root-first")?.title).toBe("Updated root"), SAVE_PAUSE);
    expect(store.folderNames()[0]).toBe("Planning");
  });

  it("skips undoing a rename of a note that is gone", async () => {
    const sidebar = await renderSidebar();
    openTreeMenu(row("Root first"));
    await clickMenuItem("Rename note");
    await typeName("Rename note", "Updated root");
    await waitFor(
      () => expect(sidebar.store.note("root-first")?.title).toBe("Updated root"),
      SAVE_PAUSE,
    );

    await sidebar.changeElsewhere({ notes: notes.filter((note) => note.id !== "root-first") });
    openTreeMenu();
    await clickMenuItem("Undo rename note");

    const titlesSaved = callsTo(sidebar.invoke, "notes.save").map(
      ([, params]) => (params as LoamBridgeParams<"notes.save">).patch.title,
    );
    expect(titlesSaved).not.toContain("Root first");
    expect(sidebar.store.note("root-first")).toBeUndefined();
  });

  it("restores deleted notes, with their tables and graphs, and deletes them again", async () => {
    const typedNote: NoteDocument = {
      ...buildNote({ id: "typed-note", title: "Typed note", position: 0 }),
      tabs: [{ id: "table-tab", title: "Table", kind: "table" }],
      blocksByTab: { "table-tab": [] },
      activeTabId: "table-tab",
      tablesByTab: {
        "table-tab": {
          columns: [{ id: "column-1", title: "Technique", type: "text", position: 0 }],
          rows: [{ id: "row-1", position: 0, cells: { "column-1": "Armbar" } }],
        },
      },
    };
    const sidebar = await renderSidebar({
      activeNoteId: typedNote.id,
      notes: [typedNote],
      folders: [],
    });
    openTreeMenu(row("Typed note"));
    await clickMenuItem("Delete note");
    await waitFor(() => expect(sidebar.store.inTrash("typed-note")).toBe(true));

    openTreeMenu();
    await clickMenuItem("Undo delete note");
    await waitFor(() =>
      expect(sidebar.store.note("typed-note")?.tablesByTab).toEqual(typedNote.tablesByTab),
    );
    // The note that was open opens again.
    await waitFor(() => expect(sidebar.activeNoteId()).toBe("typed-note"));

    openTreeMenu();
    await clickMenuItem("Redo delete note");
    await waitFor(() => expect(sidebar.store.inTrash("typed-note")).toBe(true));
  });

  it("forgets every step when asked, as permanent deletion from Trash does", async () => {
    await renderSidebar({ extra: <ForgetHistoryButton /> });
    openTreeMenu(row("Planning"));
    await clickMenuItem("Rename folder");
    await typeName("Rename folder", "Playbooks");

    fireEvent.click(screen.getByRole("button", { name: "Forget" }));

    openTreeMenu();
    const undo = await screen.findByRole("menuitem", { name: "Undo" });
    expect(undo.hasAttribute("data-disabled")).toBe(true);
  });
});

describe("a note's menu", () => {
  it("lists its actions in order, with Undo and Redo last", async () => {
    await renderSidebar();
    openTreeMenu(row("Root first"));
    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      "New sub-note",
      "Rename note",
      "Duplicate note",
      "Copy link",
      "Move to…",
      "Version history…",
      "Delete note",
      `Undo${UNDO}`,
      `Redo${REDO}`,
    ]);
    // A shortcut is announced apart from its item's name.
    const redo = within(menu).getByRole("menuitem", { name: "Redo" });
    expect(redo.getAttribute("aria-keyshortcuts")).toBe("Control+Shift+Z");
  });

  it("leaves out version history where the host keeps none", async () => {
    await renderSidebar({ capabilities: { history: false } });
    openTreeMenu(row("Root first"));
    const menu = await screen.findByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: "Version history…" })).toBeNull();
    expect(within(menu).getByRole("menuitem", { name: "Delete note" })).toBeTruthy();
  });

  it("copies a link to the note that pastes into a note as a link", async () => {
    const clipboard = stubClipboard();
    await renderSidebar({
      notes: [buildNote({ id: "plan & co", title: "Plans <draft>", position: 0 })],
      folders: [],
      activeNoteId: null,
    });
    openTreeMenu(row("Plans <draft>"));
    await clickMenuItem("Copy link");

    expect(clipboard.written).toHaveLength(1);
    const href = "/notes?noteId=plan%20%26%20co";
    expect(await clipboard.copiedLink()).toEqual({
      plainText: href,
      href,
      text: "Plans <draft>",
    });
  });
});

describe("duplicating a note", () => {
  const fullNote: NoteDocument = {
    ...buildNote({ id: "full-note", title: "Plan", folderId: "folder-planning", position: 0 }),
    tabs: [
      { id: "text-tab", title: "Notes", kind: "page" },
      { id: "graph-tab", title: "Graph", kind: "graph" },
      { id: "table-tab", title: "Table", kind: "table" },
    ],
    blocksByTab: {
      "text-tab": [{ id: "block-1", type: "paragraph", content: "Warm up first." }],
    },
    activeTabId: "graph-tab",
    graphsByTab: {
      "graph-tab": {
        enabled: true,
        nodes: [{ id: "node-1", title: "Start", position: { x: 0, y: 0 } }],
        edges: [],
      },
    },
    tablesByTab: {
      "table-tab": {
        columns: [{ id: "column-1", title: "Technique", type: "text", position: 0 }],
        rows: [{ id: "row-1", position: 0, cells: { "column-1": "Armbar" } }],
      },
    },
    video: { url: "https://www.youtube.com/watch?v=abc", videoId: "abc", lastWatchedSeconds: 42 },
  };
  const library = [
    fullNote,
    buildNote({ id: "after", title: "After", folderId: "folder-planning", position: 1 }),
    buildNote({ id: "root", title: "Root", position: 0 }),
  ];

  it("copies every tab and the video right after the note, opens it, and undoes", async () => {
    const sidebar = await renderSidebar({ notes: library, activeNoteId: "root" });
    fireEvent.click(row("Planning"));
    openTreeMenu(row("Plan"));
    await clickMenuItem("Duplicate note");

    await waitFor(() =>
      expect(sidebar.store.titlesIn("folder-planning")).toEqual(["Plan", "Plan (1)", "After"]),
    );
    const copyId = sidebar.store.noteIds().find((id) => !library.some((note) => note.id === id))!;
    const copy = sidebar.store.note(copyId)!;
    const { tabs, blocksByTab, activeTabId, graphsByTab, tablesByTab, video } = fullNote;
    expect(copy).toMatchObject({ tabs, blocksByTab, activeTabId, graphsByTab, tablesByTab, video });
    expect(sidebar.store.note("full-note")?.title).toBe("Plan");
    await waitFor(() => expect(sidebar.activeNoteId()).toBe(copyId));

    openTreeMenu();
    await clickMenuItem("Undo duplicate note");
    await waitFor(() => expect(sidebar.store.inTrash(copyId)).toBe(true));
    openTreeMenu();
    await clickMenuItem("Redo duplicate note");
    await waitFor(() => expect(sidebar.store.note(copyId)?.title).toBe("Plan (1)"));
  });

  it("numbers a copy of a copy", async () => {
    const { store } = await renderSidebar();
    openTreeMenu(row("Root later"));
    await clickMenuItem("Duplicate note");
    await waitFor(() =>
      expect(store.titlesIn(null)).toEqual(["Root first", "Root later", "Root later (1)"]),
    );
    openTreeMenu(row("Root later (1)"));
    await clickMenuItem("Duplicate note");
    await waitFor(() =>
      expect(store.titlesIn(null)).toEqual([
        "Root first",
        "Root later",
        "Root later (1)",
        "Root later (2)",
      ]),
    );
  });
});

describe("moving notes to a folder", () => {
  it("moves a note to the end of a folder or the top level, with undo", async () => {
    const { store } = await renderSidebar();
    openTreeMenu(row("Root first"));
    await clickMenuItem("Move to…");
    const here = await movePlace("No folder");
    expect(here.getAttribute("aria-disabled")).toBe("true");
    expect((await movePlace("Archive")).getAttribute("aria-disabled")).toBeNull();
    await act(async () => {
      fireEvent.click(await movePlace("Planning"));
    });
    const planningWithMoved = ["First plan", "Second plan", "Root first"];
    await waitFor(() => expect(store.titlesIn("folder-planning")).toEqual(planningWithMoved));
    expect(store.titlesIn(null)).toEqual(["Root later"]);

    openTreeMenu();
    await clickMenuItem("Undo move note");
    await waitFor(() => expect(store.titlesIn(null)).toEqual(["Root first", "Root later"]));
    expect(store.titlesIn("folder-planning")).toEqual(["First plan", "Second plan"]);

    openTreeMenu();
    await clickMenuItem("Redo move note");
    await waitFor(() => expect(store.titlesIn("folder-planning")).toEqual(planningWithMoved));

    openTreeMenu(row("First plan"));
    await moveTo("No folder");
    await waitFor(() => expect(store.titlesIn(null)).toEqual(["Root later", "First plan"]));
  });

  it("moves several selected notes as one step", async () => {
    const { store } = await renderSidebar();
    fireEvent.click(row("Root first"));
    fireEvent.click(row("Root later"), { shiftKey: true });
    openTreeMenu(row("Root later"));
    await moveTo("Archive");
    await waitFor(() =>
      expect(store.titlesIn("folder-archive")).toEqual(["Root first", "Root later"]),
    );
    expect(store.titlesIn(null)).toEqual([]);

    openTreeMenu();
    await clickMenuItem("Undo move notes");
    await waitFor(() => expect(store.titlesIn(null)).toEqual(["Root first", "Root later"]));
    expect(store.titlesIn("folder-archive")).toEqual([]);
  });

  it("finds a folder by typing and moves there with Enter", async () => {
    const { store } = await renderSidebar();
    openTreeMenu(row("Root first"));
    await clickMenuItem("Move to…");
    const search = screen.getByRole("combobox", { name: "Search folders and projects" });
    fireEvent.change(search, { target: { value: "arch" } });
    expect(
      screen.getAllByRole("option").map((option) => option.getAttribute("aria-label")),
    ).toEqual(["Archive"]);
    await act(async () => {
      fireEvent.keyDown(search, { key: "Enter" });
    });
    await waitFor(() => expect(store.titlesIn("folder-archive")).toEqual(["Root first"]));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers no move for a selection holding a folder when there are no projects", async () => {
    await renderSidebar();
    fireEvent.click(row("Root later"));
    fireEvent.click(row("Planning"), { ctrlKey: true });
    openTreeMenu(row("Planning"));
    expect(await screen.findByRole("menuitem", { name: "Delete selected" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Move to…" })).toBeNull();
  });
});
