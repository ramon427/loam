import { expect, type Locator, type Page } from "@playwright/test";

import type {
  LoamBridgeMethod,
  LoamBridgeParams,
  LoamBridgeResult,
} from "@loam/shared/bridge/loamBridge";

/** Helpers that act like a user and read back what the store saved. */

export const sidebar = (window: Page) =>
  window.getByRole("complementary", { name: "Notes library" });

/** A note or folder in the sidebar. */
export const noteRow = (window: Page, title: string) =>
  sidebar(window).getByRole("button", { name: title, exact: true });

/** The open note's body. */
export const noteBody = (window: Page): Locator => window.locator("main .bn-editor").first();

/** The open note's title field. */
const noteTitleField = (window: Page) =>
  window.getByRole("main").getByRole("heading", { level: 1 }).getByRole("textbox");

/** Types at the end of the open note's body. */
export async function appendToBody(window: Page, text: string) {
  // A click below the last block would add a block; one on the last block stays in it.
  await noteBody(window).locator(".bn-block-content").last().click();
  await window.keyboard.press("ControlOrMeta+End");
  await window.keyboard.type(text);
}

/** Creates a note from the sidebar (or in `folder`) with a title and body, and saves it. */
export async function createNote(
  window: Page,
  { title, body, folder }: { title: string; body: string; folder?: string },
) {
  if (folder) {
    await noteRow(window, folder).click({ button: "right" });
    await window.getByRole("menuitem", { name: "New note", exact: true }).click();
  } else {
    await sidebar(window)
      .getByRole("group", { name: "Create in Notes" })
      .getByRole("button", { name: "New note", exact: true })
      .click();
  }
  // A new note opens with its empty title focused. Until then the
  // note open before is still shown, so nothing here may act on the page yet.
  const titleField = noteTitleField(window);
  await expect(titleField).toBeFocused();
  await expect(titleField).toHaveValue("");
  await titleField.fill(title);
  await appendToBody(window, body);
  await expectSaved(window, title, body);
  await expect(noteRow(window, title)).toBeVisible();
}

export async function createFolder(window: Page, name: string) {
  await sidebar(window)
    .getByRole("group", { name: "Create in Notes" })
    .getByRole("button", { name: "New folder", exact: true })
    .click();
  await sidebar(window).getByRole("textbox", { name: "Folder name" }).fill(name);
  await window.keyboard.press("Enter");
  await expect(noteRow(window, name)).toBeVisible();
}

/** Creates a project from the sidebar header, with the emoji named `emoji` when given. */
export async function createProject(window: Page, name: string, emoji?: string) {
  await sidebar(window)
    .getByRole("group", { name: "Create in Notes" })
    .getByRole("button", { name: "New project", exact: true })
    .click();
  const dialog = window.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Project name").fill(name);
  if (emoji) {
    await dialog.getByRole("tab", { name: "Emoji" }).click();
    await dialog.getByRole("searchbox", { name: "Search emoji" }).fill(emoji);
    await dialog.getByRole("button", { name: emoji, exact: true }).click();
  }
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(noteRow(window, name)).toBeVisible();
}

/** Opens the settings screen at a section. */
export async function openSettings(window: Page, section: string) {
  const settings = window.getByRole("main", { name: "Settings", exact: true });
  if (!(await settings.isVisible()))
    await sidebar(window).getByRole("button", { name: "Settings" }).click();
  await window
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: section, exact: true })
    .click();
  return settings;
}

export async function openNote(window: Page, title: string) {
  await noteRow(window, title).click();
  await expect(window.getByRole("main").getByRole("heading", { name: title })).toBeVisible();
}

/** Calls the app's own bridge, to check what the store holds or set the app up. */
export const callStore = <M extends LoamBridgeMethod>(
  window: Page,
  method: M,
  params: LoamBridgeParams<M>,
) =>
  window.evaluate(
    async ({ method, params }) => {
      const result = await globalThis.window.loam.invoke(method, params);
      if (!result.ok) throw new Error(`${method} failed`);
      return result.data;
    },
    { method, params },
  ) as Promise<LoamBridgeResult<M>>;

export const storedLibrary = (window: Page) => callStore(window, "notes.library", {});

/** The saved note with this title, or null. */
export async function storedNote(window: Page, title: string) {
  const summary = (await storedLibrary(window)).notes.find((note) => note.title === title);
  return summary ? callStore(window, "notes.get", { noteId: summary.id }) : null;
}

/** The saved page tabs of a note, as JSON, for `toContain` checks. */
export async function storedText(window: Page, title: string) {
  const note = await storedNote(window, title);
  return note ? JSON.stringify(note.blocksByTab) : null;
}

/** Waits until the store holds `text` in the note titled `title`. */
export async function expectSaved(window: Page, title: string, text: string) {
  await expect.poll(async () => (await storedText(window, title)) ?? "").toContain(text);
}

/**
 * Starts a native drag from `source` and holds it over the start ("before"),
 * end ("after") edge or middle ("inside") of `target`. Returns the drag's
 * data, for a later drop.
 */
export async function holdDragOver(
  source: Locator,
  target: Locator,
  half: "before" | "after" | "inside",
) {
  const box = await target.boundingBox();
  if (!box) throw new Error("The drop target is not visible");
  const points = {
    before: { clientX: box.x + 2, clientY: box.y + 2 },
    after: { clientX: box.x + box.width - 2, clientY: box.y + box.height - 2 },
    inside: { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 },
  };
  const point = points[half];
  const dataTransfer = await source.page().evaluateHandle(() => new DataTransfer());
  await source.dispatchEvent("dragstart", { dataTransfer });
  await target.dispatchEvent("dragover", { dataTransfer, ...point });
  return { dataTransfer, point };
}

/** The drop line drawn on a drag target, or "none". */
export const dropIndicator = (target: Locator) =>
  target.evaluate((element) => getComputedStyle(element).boxShadow);
