import type { Page } from "@playwright/test";

import { expect, test } from "./app";
import { appendToBody, createNote, expectSaved, noteBody, sidebar } from "./notes";

test("writing stays in view under the header", async ({ loam }) => {
  const { window } = loam;
  await sidebar(window)
    .getByRole("group", { name: "Create in Notes" })
    .getByRole("button", { name: "New note" })
    .click();
  await window
    .getByRole("main")
    .getByRole("heading", { level: 1 })
    .getByRole("textbox")
    .fill("Visible writing");
  await noteBody(window).click();
  await window.keyboard.type("The first line remains visible while writing.");
  await expectSaved(window, "Visible writing", "first line remains visible");
  const visibleLine = async () =>
    window.evaluate(() => {
      const page = document.querySelector("[data-note-scroll]")!.getBoundingClientRect();
      const line = document.querySelector("main .bn-inline-content")!.getBoundingClientRect();
      return line.top >= page.top && line.bottom <= page.bottom;
    });
  await expect.poll(visibleLine).toBe(true);
  await noteBody(window).click();
  await window.keyboard.press("ControlOrMeta+End");
  await window.keyboard.insertText(
    "\n" + Array.from({ length: 50 }, (_, index) => `Line ${index + 1}: more writing.`).join("\n"),
  );
  await window.keyboard.type(" Still visible.");
  await expect
    .poll(() =>
      window.evaluate(() => {
        const selection = globalThis.window.getSelection();
        if (!selection?.rangeCount) return false;
        const caret = selection.getRangeAt(0).getBoundingClientRect();
        const page = document.querySelector("[data-note-scroll]")!.getBoundingClientRect();
        return caret.top >= page.top && caret.bottom <= page.bottom;
      }),
    )
    .toBe(true);
});

test("unsupported drops and pastes explain the image-only attachment support", async ({ loam }) => {
  const { window } = loam;
  await createNote(window, { title: "Files", body: "Keep these words." });
  await noteBody(window).click();
  for (const kind of ["drop", "paste"]) {
    await window.evaluate((kind) => {
      const data = new DataTransfer();
      data.items.add(new File(["PDF content"], "document.pdf", { type: "application/pdf" }));
      const event =
        kind === "drop"
          ? new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data })
          : new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data });
      document.querySelector("main .bn-editor")!.dispatchEvent(event);
      if (!event.defaultPrevented) throw new Error("Unsupported attachment was not handled");
    }, kind);
    await expect(window.getByText("This file type cannot be added", { exact: true })).toBeVisible();
    await expect(window.getByText(/Notes currently support image attachments/)).toBeVisible();
    await expect(noteBody(window)).toContainText("Keep these words.");
  }
});

test("typed shortcuts leave the caret where writing goes on, and Enter is its own undo step", async ({
  loam,
}) => {
  const { window } = loam;
  await createNote(window, { title: "Shortcuts", body: "First line" });
  await appendToBody(window, "");
  const slashMenu = window.locator("#bn-suggestion-menu");

  // "---" makes a divider, and writing goes on in a new line below it.
  await window.keyboard.press("Enter");
  await window.keyboard.type("---");
  await window.keyboard.type("Below the divider");
  await expect(noteBody(window).locator("[data-content-type=divider]")).toHaveCount(1);
  await expect(
    noteBody(window).locator("[data-content-type=paragraph]", { hasText: "Below the divider" }),
  ).toBeVisible();

  // A space right after "/" closes the menu, so Enter doesn't insert a command.
  await window.keyboard.press("Enter");
  await window.keyboard.type("/");
  await expect(slashMenu).toBeVisible();
  await window.keyboard.type(" ");
  await expect(slashMenu).toBeHidden();
  await window.keyboard.press("Backspace");
  await window.keyboard.press("Backspace");

  // The exact match comes first, ahead of loose matches in earlier sections.
  await window.keyboard.type("/table");
  await expect(slashMenu.getByRole("option").first()).toHaveText(/Table/);
  await window.keyboard.press("Enter");
  await expect(noteBody(window).locator("table")).toHaveCount(1);
  await window.keyboard.press("ControlOrMeta+z");
  await expect(noteBody(window).locator("table")).toHaveCount(0);

  await window.keyboard.type("hello");
  await window.keyboard.press("Enter");
  await window.keyboard.type("world");
  await window.keyboard.press("ControlOrMeta+z");
  await expect(noteBody(window)).not.toContainText("world");
  await expect(noteBody(window)).toContainText("hello");
});

/** Creates a note of "Before" and two columns, "Left" and "Right", made from the slash menu. */
async function createColumnsNote(window: Page, title: string) {
  await createNote(window, { title, body: "Before" });
  // Clicking the text's end; a click below the last block would add a block.
  const before = noteBody(window).getByText("Before", { exact: true });
  const box = (await before.boundingBox())!;
  await before.click({ position: { x: box.width - 1, y: box.height / 2 } });
  await window.keyboard.press("End");
  await window.keyboard.type("\n/two");
  await window.getByRole("option", { name: /Two Columns/ }).click();
  await window.keyboard.type("Left");
  const columns = noteBody(window).locator(".bn-block-column");
  await columns.nth(1).click();
  await window.keyboard.type("Right");
  await expect(columns).toHaveText(["Left", "Right"]);
  return columns;
}

test("a column emptied with Backspace goes away without leaving blocks or a gap", async ({
  loam,
}) => {
  const { window } = loam;
  const columns = await createColumnsNote(window, "Columns");

  // The list is as tall as its text, with no empty band below it.
  const [listHeight, lineHeight] = await window.evaluate(() =>
    [".bn-block-column-list", ".bn-block-content"].map(
      (selector) => document.querySelector(`main ${selector}`)!.getBoundingClientRect().height,
    ),
  );
  expect(listHeight).toBeLessThan(lineHeight! * 1.5);

  for (let key = 0; key <= "Right".length; key += 1) await window.keyboard.press("Backspace");
  await expect(columns).toHaveCount(0);
  await window.keyboard.type("!");
  await expect(noteBody(window).locator(".bn-block-content")).toHaveText(["Before", "Left!"]);
  await expectSaved(window, "Columns", "Left!");
});

test("dragging a column's block beside another column of its list keeps the block", async ({
  loam,
}) => {
  const { window } = loam;
  const columns = await createColumnsNote(window, "Column drag");

  await noteBody(window).getByText("Right", { exact: true }).hover();
  const handle = (await window.getByRole("button", { name: "Open block menu" }).boundingBox())!;
  const left = (await columns.nth(0).boundingBox())!;
  await window.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await window.mouse.down();
  // The left tenth of a block is the drop zone for a new column before it.
  await window.mouse.move(left.x + 4, left.y + left.height / 2, { steps: 12 });
  await window.mouse.up();

  await expect(columns).toHaveText(["Right", "Left"]);
  await expectSaved(window, "Column drag", "Right");
});
