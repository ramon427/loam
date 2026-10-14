// @vitest-environment jsdom

import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { NoteFolder, NoteProject } from "@loam/shared/notes/noteModel";

import {
  buildNote,
  clickMenuItem,
  dragTreeRow,
  openTreeMenu,
  renderSidebar,
  row,
  stubTreeViewport,
  typeName,
} from "./notesSidebarHarness";

stubTreeViewport();

const launch: NoteProject = { id: "project-launch", name: "Launch", position: 0 };
const garden: NoteProject = {
  id: "project-garden",
  name: "Garden",
  position: 1,
  icon: { kind: "emoji", value: "🌱" },
};
const assets: NoteFolder = {
  id: "folder-assets",
  name: "Assets",
  position: 0,
  projectId: launch.id,
};

const renderProjects = () =>
  renderSidebar({
    projects: [launch, garden],
    folders: [assets, { id: "folder-loose", name: "Loose folder", position: 1 }],
    notes: [
      buildNote({ id: "pitch", title: "Pitch", projectId: launch.id, position: 0 }),
      buildNote({ id: "logo", title: "Logo", folderId: assets.id, position: 0 }),
      buildNote({ id: "idea", title: "Loose idea", position: 0 }),
    ],
    activeNoteId: null,
  });

/** Opens a submenu of the open menu. */
const openSubmenu = async (name: string) =>
  fireEvent.click(await screen.findByRole("menuitem", { name }));

/** Fills in the open project dialog, picking a line icon, and submits it. */
const submitProject = async (name: string, icon?: string) => {
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Project name"), { target: { value: name } });
  if (icon) {
    fireEvent.click(within(dialog).getByRole("tab", { name: "Icons" }));
    fireEvent.click(within(dialog).getByRole("button", { name: icon }));
  }
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: /^(Create project|Save)$/ }));
  });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
};

describe("projects in the notes tree", () => {
  it("shows projects first, holding their notes and folders", async () => {
    await renderProjects();
    const names = screen
      .getAllByRole("button")
      .filter((button) => button.closest("nav"))
      .map((button) => button.textContent);
    expect(names.slice(0, 5)).toEqual(["Launch", "Pitch", "Assets", "🌱GardenEmpty", "Loose idea"]);
    // The emoji and the empty hint are not part of the project's name.
    expect(row("Garden").getAttribute("aria-expanded")).toBe("true");
  });

  it("creates a project with an icon from the menu, and undoes it", async () => {
    const { store } = await renderSidebar({ activeNoteId: null });
    openTreeMenu();
    await clickMenuItem("New project…");
    await submitProject("Launch", "Rocket");

    expect(store.project("Launch")?.icon).toEqual({
      kind: "symbol",
      value: "rocket",
      color: "blue",
    });
    expect(row("Launch")).toBeTruthy();

    openTreeMenu();
    await clickMenuItem("Undo new project");
    await waitFor(() => expect(store.projectNames()).toEqual([]));
  });

  it("makes folders and notes inside a project from its menu", async () => {
    const { store } = await renderProjects();
    openTreeMenu(row("Garden"));
    await clickMenuItem("New folder");
    await typeName("Folder name", "Seeds");
    expect(store.folder("Seeds")?.projectId).toBe(garden.id);

    openTreeMenu(row("Garden"));
    await clickMenuItem("New note");
    await waitFor(() =>
      expect(store.noteIds().map((noteId) => store.note(noteId)?.projectId)).toContain(garden.id),
    );
  });

  it("moves a note and a folder into a project, and back with undo", async () => {
    const { store } = await renderProjects();
    openTreeMenu(row("Loose idea"));
    await openSubmenu("Move to project");
    await clickMenuItem("Garden");
    expect(store.note("idea")?.projectId).toBe(garden.id);

    openTreeMenu(row("Assets"));
    await openSubmenu("Move to project");
    await clickMenuItem("No project");
    expect(store.folder("Assets")?.projectId).toBeUndefined();

    openTreeMenu(row("Loose folder"));
    await clickMenuItem("Undo move folder");
    await waitFor(() => expect(store.folder("Assets")?.projectId).toBe(launch.id));
    openTreeMenu(row("Loose folder"));
    await clickMenuItem("Undo move note");
    await waitFor(() => expect(store.note("idea")?.projectId).toBeUndefined());
  });

  it("drops a note on a project to move it in", async () => {
    const { store } = await renderProjects();
    await dragTreeRow("Loose idea", "Launch");
    await waitFor(() => expect(store.note("idea")?.projectId).toBe(launch.id));
  });

  it("removes a project, keeping what it held, and brings it all back with undo", async () => {
    const { store } = await renderProjects();
    openTreeMenu(row("Launch"));
    await clickMenuItem("Remove project");

    expect(store.projectNames()).toEqual(["Garden"]);
    expect(store.folder("Assets")?.projectId).toBeUndefined();
    expect(store.note("pitch")?.projectId).toBeUndefined();
    expect(store.note("logo")?.folderId).toBe(assets.id);

    openTreeMenu();
    await clickMenuItem("Undo remove project");
    await waitFor(() => expect(store.projectNames()).toEqual(["Launch", "Garden"]));
    expect(store.folder("Assets")?.projectId).toBe(launch.id);
    expect(store.note("pitch")?.projectId).toBe(launch.id);
  });

  it("renames a project and changes its icon, as one step to undo", async () => {
    const { store } = await renderProjects();
    openTreeMenu(row("Garden"));
    await clickMenuItem("Edit project…");
    await submitProject("Allotment", "Leaf");
    expect(store.project("Allotment")?.icon).toMatchObject({ kind: "symbol", value: "leaf" });

    openTreeMenu();
    await clickMenuItem("Undo edit project");
    await waitFor(() => expect(store.project("Garden")?.icon).toEqual(garden.icon));
  });

  it("closes and opens a project, which stays as left", async () => {
    await renderProjects();
    fireEvent.click(row("Launch"));
    expect(row("Launch").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "Pitch" })).toBeNull();
    expect(
      JSON.parse(localStorage.getItem("loam:notes.sidebar.closed-project-ids") ?? "[]"),
    ).toEqual([launch.id]);
  });
});
