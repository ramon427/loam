import { expect, test } from "./app";
import { createNote, createProject, noteRow, sidebar, storedLibrary } from "./notes";

test("projects hold folders and notes, and the filter shows any mix of them", async ({ loam }) => {
  const { window } = loam;
  await createProject(window, "Launch", "Rocket");
  await createProject(window, "Garden");
  await createNote(window, { title: "Loose idea", body: "Outside every project." });
  await createNote(window, { title: "Press kit", body: "In the project.", folder: "Launch" });

  // A folder made from a project's menu lands in that project.
  await noteRow(window, "Launch").click({ button: "right" });
  await window.getByRole("menuitem", { name: "New folder", exact: true }).click();
  await sidebar(window).getByRole("textbox", { name: "Folder name" }).fill("Assets");
  await window.keyboard.press("Enter");
  await createNote(window, { title: "Logo", body: "In a project's folder.", folder: "Assets" });

  const library = await storedLibrary(window);
  const project = (name: string) => library.projects.find((entry) => entry.name === name)!;
  expect(project("Launch").icon).toEqual({ kind: "emoji", value: "🚀" });
  expect(library.folders.find((folder) => folder.name === "Assets")?.projectId).toBe(
    project("Launch").id,
  );
  expect(library.notes.find((note) => note.title === "Press kit")?.projectId).toBe(
    project("Launch").id,
  );

  // A note moves into another project from its menu.
  await noteRow(window, "Loose idea").click({ button: "right" });
  await window.getByRole("menuitem", { name: "Move to…" }).click();
  await window.getByRole("option", { name: "Garden, Project" }).click();
  await expect
    .poll(
      async () =>
        (await storedLibrary(window)).notes.find((note) => note.title === "Loose idea")?.projectId,
    )
    .toBe(project("Garden").id);

  // The filter shows any mix of projects.
  const tick = async (name: string) => {
    await sidebar(window)
      .getByRole("button", { name: /^Filter notes/ })
      .click();
    await window.getByRole("menuitemcheckbox", { name, exact: true }).click();
    await window.keyboard.press("Escape");
  };
  await tick("Launch");
  await expect(noteRow(window, "Press kit")).toBeVisible();
  await expect(noteRow(window, "Loose idea")).toHaveCount(0);
  await tick("Garden");
  await expect(noteRow(window, "Loose idea")).toBeVisible();
  await expect(noteRow(window, "Press kit")).toBeVisible();

  // Projects outlast a restart.
  await loam.restart();
  await expect(noteRow(loam.window, "Launch")).toBeVisible();
  expect((await storedLibrary(loam.window)).projects.map((entry) => entry.name)).toEqual([
    "Launch",
    "Garden",
  ]);
});

test("removing a project keeps what it held, and undo puts it back", async ({ loam }) => {
  const { window } = loam;
  await createProject(window, "Launch");
  await createNote(window, { title: "Press kit", body: "In the project.", folder: "Launch" });

  await noteRow(window, "Launch").click({ button: "right" });
  await window.getByRole("menuitem", { name: "Remove project" }).click();
  await expect(noteRow(window, "Launch")).toHaveCount(0);
  await expect(noteRow(window, "Press kit")).toBeVisible();
  expect((await storedLibrary(window)).projects).toEqual([]);

  await window.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(noteRow(window, "Launch")).toBeVisible();
  await expect
    .poll(async () => {
      const library = await storedLibrary(window);
      return library.notes.find((note) => note.title === "Press kit")?.projectId;
    })
    .toBe((await storedLibrary(window)).projects[0]?.id);
});
