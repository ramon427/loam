import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "./app";
import {
  appendToBody,
  createNote,
  expectSaved,
  noteBody,
  noteRow,
  openNote,
  openSettings,
  storedLibrary,
  storedText,
} from "./notes";

test("restores an earlier version from the note's history", async ({ loam }) => {
  const { window } = loam;
  await createNote(window, { title: "Recipe", body: "Two eggs." });
  await expectSaved(window, "Recipe", "Two eggs.");
  // A version is kept when content last kept over ten minutes ago changes.
  await loam.advanceClock(11 * 60 * 1000);
  await appendToBody(window, " Three eggs.");
  await expectSaved(window, "Recipe", "Three eggs.");

  await noteRow(window, "Recipe").click({ button: "right" });
  await window.getByRole("menuitem", { name: "Version history…" }).click();
  const dialog = window.getByRole("dialog", { name: "Version history" });
  await dialog.getByRole("list", { name: "Versions" }).getByRole("button").first().click();
  await expect(dialog).toContainText("Two eggs.");
  await expect(dialog).not.toContainText("Three eggs.");
  await window.evaluate(() => Object.assign(window, { __beforeRestore: true }));
  await dialog.getByRole("button", { name: "Restore this version" }).click();

  // The open note shows the restored content without reloading the window.
  await expect(window.getByText(/^Restored "Recipe"/)).toBeVisible();
  await expect(noteBody(window)).toContainText("Two eggs.");
  await expect(noteBody(window)).not.toContainText("Three eggs.");
  expect(await storedText(window, "Recipe")).not.toContain("Three eggs.");
  expect(await window.evaluate(() => "__beforeRestore" in window)).toBe(true);
});

test("imports a Markdown folder with its subfolders", async ({ loam }) => {
  const vault = join(loam.root, "Vault");
  mkdirSync(join(vault, "Work"), { recursive: true });
  writeFileSync(join(vault, "Ideas.md"), "# Ideas\n\nGrow tomatoes.\n");
  writeFileSync(join(vault, "Work", "Standup.md"), "Talk about [[Ideas]].\n");
  await loam.answerFilePickers([vault]);

  const settings = await openSettings(loam.window, "Import & export");
  await loam.window.evaluate(() => Object.assign(window, { __beforeImport: true }));
  await settings.getByRole("button", { name: "Import…", exact: true }).click();
  const summary = loam.window.getByRole("dialog", { name: "Import finished" });
  await expect(summary).toContainText("2 notes");
  await summary.getByRole("button", { name: "Done" }).click();
  await loam.window.getByRole("button", { name: /Back to notes/ }).click();
  // The library shows the imported notes without the window reloading.
  await expect(noteRow(loam.window, "Ideas")).toBeVisible();
  expect(await loam.window.evaluate(() => "__beforeImport" in window)).toBe(true);

  const library = await storedLibrary(loam.window);
  expect(library.notes.map((note) => note.title).sort()).toEqual(["Ideas", "Standup"]);
  const work = library.folders.find((folder) => folder.name === "Work");
  expect(library.notes.find((note) => note.title === "Standup")?.folderId).toBe(work?.id);
  expect(await storedText(loam.window, "Ideas")).toContain("Grow tomatoes.");
});

test("exports every note as Markdown files", async ({ loam }) => {
  await createNote(loam.window, { title: "Export me", body: "Exported body" });
  await expectSaved(loam.window, "Export me", "Exported body");
  const exports = join(loam.root, "exports");
  mkdirSync(exports);
  await loam.answerFilePickers([exports]);

  const settings = await openSettings(loam.window, "Import & export");
  await settings.getByRole("button", { name: "Export…", exact: true }).click();
  await loam.window
    .getByRole("dialog", { name: "Export as Markdown" })
    .getByRole("button", { name: /^All notes/ })
    .click();
  await expect(loam.window.getByText(/^Exported 1 note/)).toBeVisible();

  const [folder] = readdirSync(exports);
  expect(folder).toMatch(/^Loam export /);
  expect(readFileSync(join(exports, folder!, "Export me.md"), "utf8")).toContain("Exported body");
});

test("exports the open note from the command palette", async ({ loam }) => {
  const { window } = loam;
  await createNote(window, { title: "Only me", body: "Single export" });
  await createNote(window, { title: "Not me", body: "Left out" });
  await openNote(window, "Only me");
  const exports = join(loam.root, "exports");
  mkdirSync(exports);
  await loam.answerFilePickers([exports]);

  await window.keyboard.press("ControlOrMeta+Shift+p");
  await window.getByRole("combobox", { name: "Search commands" }).fill("export");
  await window.keyboard.press("Enter");
  await window
    .getByRole("dialog", { name: "Export as Markdown" })
    .getByRole("button", { name: "This note: Only me" })
    .click();
  await expect(window.getByText(/^Exported 1 note/)).toBeVisible();

  const files = readdirSync(exports, { recursive: true }).map(String);
  expect(files.some((file) => file.endsWith("Only me.md"))).toBe(true);
  expect(files.some((file) => file.endsWith("Not me.md"))).toBe(false);
});

test("backs up and restores the whole library", async ({ loam }) => {
  await createNote(loam.window, { title: "Before", body: "Kept." });
  await expectSaved(loam.window, "Before", "Kept.");
  let settings = await openSettings(loam.window, "Backups");
  await settings.getByRole("button", { name: "Back up now" }).click();
  const backups = settings.getByRole("list", { name: "Backups" });
  await expect(backups.getByRole("listitem")).toHaveCount(1);
  await loam.window.keyboard.press("Escape");

  await createNote(loam.window, { title: "After", body: "Gone after the restore." });
  await expectSaved(loam.window, "After", "Gone after the restore.");
  settings = await openSettings(loam.window, "Backups");
  await settings.getByRole("button", { name: "Restore…" }).click();
  await loam.expectSelfRestart(() =>
    loam.window
      .getByRole("dialog", { name: "Restore this backup?" })
      .getByRole("button", { name: "Restore", exact: true })
      .click(),
  );

  await expect
    .poll(async () => (await storedLibrary(loam.window)).notes.map((note) => note.title))
    .toEqual(["Before"]);
  await expect(noteRow(loam.window, "After")).toHaveCount(0);
  // The library as it was before the restore is backed up too.
  settings = await openSettings(loam.window, "Backups");
  await expect(settings.getByRole("list", { name: "Backups" }).getByRole("listitem")).toHaveCount(
    2,
  );
});
