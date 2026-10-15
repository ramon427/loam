import { expect, test } from "./app";
import {
  appendToBody,
  createFolder,
  createNote,
  dropIndicator,
  expectSaved,
  holdDragOver,
  noteBody,
  noteRow,
  openNote,
  sidebar,
  storedLibrary,
  storedNote,
} from "./notes";

const chooseFolder = async (window: import("@playwright/test").Page, name: string) => {
  await sidebar(window)
    .getByRole("button", { name: /^Filter notes/ })
    .click();
  await window.getByRole("menuitemcheckbox", { name, exact: true }).click();
};

/** How opaque an element shows: its opacity times every ancestor's. */
const shownOpacity = (locator: import("@playwright/test").Locator) =>
  locator.evaluate((element) => {
    let opacity = 1;
    for (let node: Element | null = element; node; node = node.parentElement)
      opacity *= Number(getComputedStyle(node).opacity);
    return opacity;
  });

test("a new note is saved and survives a restart", async ({ loam }) => {
  await createNote(loam.window, { title: "Groceries", body: "Milk and bread" });
  await expectSaved(loam.window, "Groceries", "Milk and bread");
  await loam.restart();
  await openNote(loam.window, "Groceries");
  await expect(noteBody(loam.window)).toContainText("Milk and bread");
});

test("edits save on their own while typing", async ({ loam }) => {
  const { window } = loam;
  await createNote(window, { title: "Draft", body: "First line." });
  await appendToBody(window, " Autosaved words");
  await expectSaved(window, "Draft", "Autosaved words");
});

test("an edit made just before quitting is kept", async ({ loam }) => {
  await createNote(loam.window, { title: "Quick", body: "Start." });
  await appendToBody(loam.window, " Last second");
  await loam.restart();
  await openNote(loam.window, "Quick");
  await expect(noteBody(loam.window)).toContainText("Last second");
});

test("renames a note from the sidebar", async ({ loam }) => {
  const { window } = loam;
  await createNote(window, { title: "Old name", body: "Body" });
  await noteRow(window, "Old name").click({ button: "right" });
  await window.getByRole("menuitem", { name: "Rename note" }).click();
  await expect(sidebar(window).getByRole("textbox", { name: "Rename note" })).toBeFocused();
  await window.keyboard.press("ControlOrMeta+a");
  await window.keyboard.type("New name");
  await window.keyboard.press("Enter");
  await expect(noteRow(window, "New name")).toBeVisible();
  await expect
    .poll(async () => (await storedLibrary(window)).notes.map((note) => note.title))
    .toEqual(["New name"]);
});

test("renaming a note that hasn't been opened keeps its body", async ({ loam }) => {
  await createNote(loam.window, { title: "Recipe", body: "Two eggs and flour" });
  await createNote(loam.window, { title: "Other", body: "Something else" });
  // After a restart, "Recipe" hasn't been read in full yet; the sidebar only lists it.
  await loam.restart();
  const { window } = loam;
  await noteRow(window, "Recipe").click({ button: "right" });
  await window.getByRole("menuitem", { name: "Rename note" }).click();
  await expect(sidebar(window).getByRole("textbox", { name: "Rename note" })).toBeFocused();
  await window.keyboard.press("ControlOrMeta+a");
  await window.keyboard.type("Pancakes");
  await window.keyboard.press("Enter");
  await openNote(window, "Pancakes");
  await expect(noteBody(window)).toContainText("Two eggs and flour");
  await appendToBody(window, " and milk");
  await expectSaved(window, "Pancakes", "Two eggs and flour and milk");
});

test("deletes a note and brings it back with undo", async ({ loam }) => {
  const { window } = loam;
  await createNote(window, { title: "Keep me", body: "Body" });
  await createNote(window, { title: "Remove me", body: "Body" });
  await noteRow(window, "Remove me").click({ button: "right" });
  await window.getByRole("menuitem", { name: "Delete note" }).click();
  const confirm = window.getByRole("dialog");
  if (await confirm.isVisible()) await confirm.getByRole("button", { name: "Delete note" }).click();
  await expect(noteRow(window, "Remove me")).toHaveCount(0);
  await window.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(noteRow(window, "Remove me")).toBeVisible();
  await expect.poll(async () => (await storedLibrary(window)).notes.length).toBe(2);
});

test("search finds a note by a word in its body and opens it", async ({ loam }) => {
  const { window } = loam;
  await createNote(window, { title: "Trip", body: "Pack the zephyrine charger" });
  await createNote(window, { title: "Other", body: "Nothing here" });
  await window.getByRole("searchbox", { name: "Search notes" }).fill("zephyrine");
  const results = window.getByRole("list", { name: "Search results" });
  await expect(results).toContainText("Trip");
  await expect(results).not.toContainText("Other");
  await window.keyboard.press("Enter");
  await expect(window.getByRole("main").getByRole("heading", { name: "Trip" })).toBeVisible();
});

test("links notes with @ and shows the backlink", async ({ loam }) => {
  const { window } = loam;
  await createNote(window, { title: "Target", body: "Linked to." });
  await createNote(window, { title: "Source", body: "See " });
  // A row added to the tree fades in once and ends fully shown.
  await expect.poll(() => shownOpacity(noteRow(window, "Source"))).toBe(1);
  await appendToBody(window, " @Targ");
  await window
    .getByRole("listbox", { name: "Note mentions" })
    .getByRole("option", { name: /Target/ })
    .click();
  await expect(noteBody(window).getByRole("link", { name: /Target/ })).toBeVisible();
  const target = (await storedNote(window, "Target"))!;
  await expectSaved(window, "Source", `/notes?noteId=${target.id}`);
  await openNote(window, "Target");
  await window.getByRole("button", { name: "Linked from 1 place" }).click();
  // The linking note opens in place; the window doesn't reload.
  await window.evaluate(() => Object.assign(window, { __beforeBacklink: true }));
  await window.getByRole("menuitem", { name: /Source/ }).click();
  await expect(window.getByRole("main").getByRole("heading", { name: "Source" })).toBeVisible();
  expect(await window.evaluate(() => "__beforeBacklink" in window)).toBe(true);
});

test("a note made in a folder saves at once and after a restart", async ({ loam }) => {
  await createFolder(loam.window, "Projects");
  await createNote(loam.window, { title: "Plan", body: "Phase one.", folder: "Projects" });
  await expectSaved(loam.window, "Plan", "Phase one.");
  const library = await storedLibrary(loam.window);
  const folder = library.folders.find((entry) => entry.name === "Projects");
  expect(library.notes.find((note) => note.title === "Plan")?.folderId).toBe(folder?.id);

  await loam.restart();
  await openNote(loam.window, "Plan");
  await appendToBody(loam.window, " Phase two.");
  await expectSaved(loam.window, "Plan", "Phase two.");
});

test("dragging a note shows a line where it will land", async ({ loam }) => {
  const { window } = loam;
  await createNote(window, { title: "Moving", body: "Body" });
  await createNote(window, { title: "Staying", body: "Body" });
  const target = noteRow(window, "Staying");
  expect(await dropIndicator(target)).toBe("none");

  const drag = await holdDragOver(noteRow(window, "Moving"), target, "after");
  await expect.poll(() => dropIndicator(target)).not.toBe("none");

  await target.dispatchEvent("drop", { dataTransfer: drag.dataTransfer, ...drag.point });
  await expect.poll(() => dropIndicator(target)).toBe("none");
  const tree = sidebar(window).getByRole("navigation", { name: "Notes" });
  await expect(tree.getByRole("button")).toHaveText(["Staying", "Moving"]);
});

test("toolbar and keyboard creation keep the selected folder and restart reopens the last note", async ({
  loam,
}) => {
  const { window } = loam;
  await createFolder(window, "Projects");
  await chooseFolder(window, "Projects");
  await window.getByRole("main").getByRole("button", { name: "New note", exact: true }).click();
  await window
    .getByRole("main")
    .getByRole("heading", { level: 1 })
    .getByRole("textbox")
    .fill("Toolbar note");
  await appendToBody(window, "Filed automatically.");
  await expectSaved(window, "Toolbar note", "Filed automatically.");
  const folder = (await storedLibrary(window)).folders.find((item) => item.name === "Projects")!.id;
  expect(
    (await storedLibrary(window)).notes.find((note) => note.title === "Toolbar note")?.folderId,
  ).toBe(folder);
  await noteBody(window).click();
  await window.keyboard.press("ControlOrMeta+n");
  await expect(
    window.getByRole("main").getByRole("heading", { level: 1 }).getByRole("textbox"),
  ).toBeFocused();
  await window
    .getByRole("main")
    .getByRole("heading", { level: 1 })
    .getByRole("textbox")
    .fill("Keyboard note");
  await appendToBody(window, "Created from the keyboard.");
  await expectSaved(window, "Keyboard note", "Created from the keyboard.");
  expect(
    (await storedLibrary(window)).notes.find((note) => note.title === "Keyboard note")?.folderId,
  ).toBe(folder);
  await loam.restart();
  await expect(
    loam.window.getByRole("main").getByRole("heading", { name: "Keyboard note" }),
  ).toBeVisible();
  await expect(noteBody(loam.window)).toContainText("Created from the keyboard.");
});
