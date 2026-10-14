import { DESKTOP, expect, test } from "./app";
import { appendToBody, createNote, expectSaved, noteBody, noteRow, storedNote } from "./notes";

test("a tab's right-click menu renames it", async ({ loam }) => {
  const { window } = loam;
  await createNote(window, { title: "Course", body: "Overview." });
  const main = window.getByRole("main");
  await main.getByRole("button", { name: "Notes", exact: true }).click({ button: "right" });
  await window.getByRole("menuitem", { name: "Rename tab…" }).click();
  const dialog = window.getByRole("dialog", { name: "Rename editor tab?" });
  await dialog.getByLabel("Tab name").fill("Outline");
  await dialog.getByRole("button", { name: "Rename tab" }).click();
  await expect(main.getByRole("button", { name: "Outline", exact: true })).toBeVisible();
  await expect
    .poll(async () => (await storedNote(window, "Course"))?.tabs.map((tab) => tab.title))
    .toEqual(["Outline"]);
});

test("text fields get the native edit menu, and the app's own menus replace it", async ({
  loam,
}) => {
  const { window } = loam;
  await createNote(window, { title: "Plan", body: "Steps." });
  const nativeMenus = await loam.recordNativeMenus();

  await window.locator("#notes-search-input").click({ button: "right" });
  await expect.poll(nativeMenus).toEqual([["undo", "redo", "cut", "copy", "paste", "selectall"]]);
  await expect(window.getByRole("menu")).toHaveCount(0);

  await noteRow(window, "Plan").click({ button: "right" });
  await expect(window.getByRole("menuitem", { name: "Rename note" })).toBeVisible();
  expect(await nativeMenus()).toHaveLength(1);
});

test(
  "a note's copied link pastes into another note as a link that opens it",
  DESKTOP,
  async ({ loam }) => {
    const { window } = loam;
    await createNote(window, { title: "Target", body: "Linked to." });
    await createNote(window, { title: "Source", body: "See" });
    await noteRow(window, "Target").click({ button: "right" });
    await window.getByRole("menuitem", { name: "Copy link", exact: true }).click();
    await expect(window.getByText("Link copied")).toBeVisible();

    await appendToBody(window, " ");
    await window.keyboard.press("ControlOrMeta+V");
    const link = noteBody(window).getByRole("link", { name: "Target" });
    await expect(link).toBeVisible();
    const target = (await storedNote(window, "Target"))!;
    await expectSaved(window, "Source", `/notes?noteId=${target.id}`);

    // A plain click places the cursor in the link; Ctrl/Cmd+click follows it.
    await link.click({ modifiers: ["ControlOrMeta"] });
    await expect(window.getByRole("main").getByRole("heading", { name: "Target" })).toBeVisible();
  },
);

test("the editor's block menu pastes from the clipboard", DESKTOP, async ({ loam }) => {
  const { window } = loam;
  await createNote(window, { title: "Clipboard", body: "Before." });
  await noteBody(window).click();
  await window.keyboard.press("ControlOrMeta+End");
  await loam.writeClipboard(" Pasted words.");
  await noteBody(window).getByText("Before.").click({ button: "right" });
  await window.getByRole("menuitem", { name: "Paste", exact: true }).click();
  await expect(noteBody(window)).toContainText("Pasted words.");
});

test("a note link's right-click menu replaces the native one and opens the note", async ({
  loam,
}) => {
  const { window } = loam;
  await createNote(window, { title: "Target", body: "Linked to." });
  await createNote(window, { title: "Source", body: "See " });
  await appendToBody(window, " @Targ");
  await window
    .getByRole("listbox", { name: "Note mentions" })
    .getByRole("option", { name: /Target/ })
    .click();
  const nativeMenus = await loam.recordNativeMenus();
  const link = noteBody(window).getByRole("link", { name: /Target/ });

  await link.click({ button: "right" });
  const menu = window.getByRole("menu", { name: "Link actions" });
  await expect(menu.getByRole("menuitem")).toHaveText(["Open note", "Copy link", "Remove link"]);
  await window.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  await link.click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Open note" }).click();
  await expect(window.getByRole("main").getByRole("heading", { name: "Target" })).toBeVisible();
  expect(await nativeMenus()).toEqual([]);
});
