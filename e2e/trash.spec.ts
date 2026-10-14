import { expect, test } from "./app";
import { appendToBody, createFolder, createNote, noteBody, noteRow, storedLibrary } from "./notes";

test("deleted notes and their last edits can be restored from Trash after restart", async ({
  loam,
}) => {
  await createFolder(loam.window, "Work");
  await createNote(loam.window, { title: "Keep", body: "Keep this note." });
  await createNote(loam.window, { title: "Recover", body: "Original words.", folder: "Work" });
  const originalFolder = (await storedLibrary(loam.window)).folders.find(
    (folder) => folder.name === "Work",
  )!.id;
  await appendToBody(loam.window, " Last unsaved words.");
  await noteRow(loam.window, "Recover").click({ button: "right" });
  await loam.window.getByRole("menuitem", { name: "Delete note" }).click();
  await loam.window
    .getByRole("dialog", { name: "Delete note?" })
    .getByRole("button", { name: "Delete note" })
    .click();
  await expect(noteRow(loam.window, "Recover")).toHaveCount(0);
  await loam.restart();
  await loam.window.getByRole("button", { name: "Trash", exact: true }).click();
  const trash = loam.window.getByRole("dialog", { name: "Trash", exact: true });
  await trash
    .getByRole("group", { name: "Recover", exact: true })
    .getByRole("button", { name: "Restore", exact: true })
    .click();
  await expect(trash).toHaveCount(0);
  await expect(noteBody(loam.window)).toContainText("Last unsaved words.");
  const notes = (await storedLibrary(loam.window)).notes;
  expect(notes.find((note) => note.title === "Recover")?.folderId).toBe(originalFolder);
  expect(notes.map((note) => note.title).sort()).toEqual(["Keep", "Recover"]);
});

test("permanent deletion clears Undo snapshots and leaves the other notes alone", async ({
  loam,
}) => {
  const { window } = loam;
  await createNote(window, { title: "Surviving note", body: "Keep this content." });
  await createNote(window, { title: "Forget me", body: "Removed content." });
  await noteRow(window, "Forget me").click({ button: "right" });
  await window.getByRole("menuitem", { name: "Delete note", exact: true }).click();
  await window
    .getByRole("dialog", { name: "Delete note?" })
    .getByRole("button", { name: "Delete note", exact: true })
    .click();
  await window.getByRole("button", { name: "Trash", exact: true }).click();
  const trash = window.getByRole("dialog", { name: "Trash", exact: true });
  await trash.getByRole("button", { name: "Permanently delete Forget me", exact: true }).click();
  await window
    .getByRole("dialog", { name: "Permanently delete this note?" })
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();
  await expect(trash).toContainText("Trash is empty.");
  await window.keyboard.press("Escape");
  await noteRow(window, "Surviving note").click({ button: "right" });
  await expect(window.getByRole("menuitem", { name: "Undo", exact: true })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await window.keyboard.press("Escape");
  expect((await storedLibrary(window)).notes.map((note) => note.title)).toEqual(["Surviving note"]);
});
