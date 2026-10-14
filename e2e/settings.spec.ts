import { expect, test } from "./app";
import {
  appendToBody,
  createNote,
  expectSaved,
  noteBody,
  openSettings,
  sidebar,
  storedLibrary,
} from "./notes";

test("settings fills the workspace and returns to the same editor and draft", async ({ loam }) => {
  const { window } = loam;
  await createNote(window, { title: "In progress", body: "Keep this note." });
  await appendToBody(window, " Still writing.");
  await noteBody(window).evaluate((element) => {
    element.setAttribute("data-settings-editor", "original");
  });
  await window.keyboard.press("ControlOrMeta+Comma");

  const settings = window.getByRole("main", { name: "Settings", exact: true });
  await expect(settings).toBeVisible();
  await expect(window.getByRole("dialog", { name: "Settings" })).toHaveCount(0);
  await expect(sidebar(window)).toBeHidden();
  await expect(window.getByRole("button", { name: "Collapse sidebar" })).toHaveCount(0);
  const dimensions = await window.getByTestId("settings-screen").boundingBox();
  const viewport =
    window.viewportSize() ??
    (await window.evaluate(() => ({ width: innerWidth, height: innerHeight })));
  expect(dimensions?.x).toBe(0);
  expect(dimensions?.width).toBe(viewport.width);

  // Workspace shortcuts must not change a note while its editor is hidden.
  await window.keyboard.press("ControlOrMeta+n");
  expect((await storedLibrary(window)).notes.map((note) => note.title)).toEqual(["In progress"]);
  await window.getByRole("button", { name: /Back to notes/ }).click();
  await expect(settings).toBeHidden();
  await expect(noteBody(window)).toHaveAttribute("data-settings-editor", "original");
  await expect(noteBody(window)).toContainText("Still writing.");
  await expect
    .poll(() => noteBody(window).evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
  await appendToBody(window, " More writing.");
  await expectSaved(window, "In progress", "More writing.");
});

test("settings search and Escape respect nested forms and remember the section", async ({
  loam,
}) => {
  const { window } = loam;
  await openSettings(window, "Data");
  await window.keyboard.press("ControlOrMeta+f");
  const search = window.getByRole("combobox", { name: "Search settings" });
  await expect(search).toBeFocused();
  await search.fill("password");
  await expect(window.getByRole("option", { name: /Security/ })).toBeVisible();
  await window.keyboard.press("Enter");
  await expect(window.getByRole("heading", { name: "Security", exact: true })).toBeVisible();

  await window.getByRole("button", { name: "Encrypt my notes…" }).click();
  const form = window.getByRole("dialog", { name: "Encrypt your notes" });
  await expect(form).toBeVisible();
  await window.keyboard.press("Escape");
  await expect(form).toBeHidden();
  await expect(window.getByRole("main", { name: "Settings", exact: true })).toBeVisible();

  await window.keyboard.press("ControlOrMeta+f");
  await search.fill("no such setting");
  await expect(window.getByText(/No settings found/)).toBeVisible();
  await window.keyboard.press("Escape");
  await expect(search).toHaveValue("");
  await expect(window.getByRole("main", { name: "Settings", exact: true })).toBeVisible();
  await window.keyboard.press("Escape");
  await expect(sidebar(window)).toBeVisible();
  await window.keyboard.press("ControlOrMeta+Comma");
  await expect(window.getByRole("heading", { name: "Security", exact: true })).toBeVisible();
});

test("settings fits compact windows and keeps details out of the main flow", async ({ loam }) => {
  await loam.setWindowSize(820, 620);
  const { window } = loam;
  const settings = await openSettings(window, "Data");
  await expect(settings.getByText("Storage details", { exact: true })).toBeVisible();
  await expect(settings.getByTestId("settings-storage-adapter")).toBeHidden();
  await settings.getByText("Storage details", { exact: true }).click();
  await expect(settings.getByTestId("settings-storage-adapter")).toBeVisible();
  for (const section of [
    "Import & export",
    "Backups",
    "Sync",
    "Security",
    "AI access",
    "Updates",
  ]) {
    await openSettings(window, section);
    expect(await settings.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
  }
  await openSettings(window, "Backups");
  await expect(settings.getByRole("button", { name: "Back up now" })).toBeVisible();
  await expect(settings.getByRole("button", { name: "Restore from a file…" })).toBeVisible();
  await expect(settings.getByRole("button", { name: "Open folder" })).toBeHidden();
  await settings.getByText("Backup details", { exact: true }).click();
  await expect(settings.getByRole("button", { name: "Open folder" })).toBeVisible();
});

test("opens settings with its shortcut and leaves room for the window buttons", async ({
  loam,
}) => {
  await expect(loam.window.getByRole("complementary", { name: "Notes library" })).toContainText(
    "Loam",
  );
  await loam.window.keyboard.press("ControlOrMeta+Comma");
  await expect(loam.window.getByRole("main", { name: "Settings", exact: true })).toBeVisible();
  if (process.platform !== "darwin") {
    // The native minimize, maximize and close buttons sit over the page.
    const overlay = await loam.window.evaluate(
      () =>
        (navigator as { windowControlsOverlay?: { visible: boolean } }).windowControlsOverlay
          ?.visible,
    );
    expect(overlay).toBe(true);
  }
});
