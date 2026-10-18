import type { Page } from "@playwright/test";

import { expect, test } from "./app";
import { createNote, expectSaved, noteBody, noteRow } from "./notes";

const LINES = ["First line of text", "Second line, a little longer than the first", "Third line"];

/** A note with three paragraphs, the caret at the end of the last. */
async function createThreeLineNote(window: Page) {
  await createNote(window, { title: "Lines", body: LINES[0]! });
  for (const line of LINES.slice(1)) {
    await window.keyboard.press("Enter");
    await window.keyboard.type(line);
  }
  await expectSaved(window, "Lines", LINES[2]!);
}

/** What the window has selected, as copying it would read. */
const selectedText = (window: Page) =>
  window.evaluate(() => document.getSelection()?.toString().replace(/\n+/g, "\n") ?? "");

const lineBox = async (window: Page, index: number) =>
  (await noteBody(window).locator(".bn-inline-content").nth(index).boundingBox())!;

const lineTexts = (window: Page) =>
  noteBody(window).locator(".bn-inline-content").allTextContents();

/**
 * Clicks, then lets the editor take up the caret: it reads a click's caret from the browser's
 * selection a moment later, and a key pressed sooner than a person could acts on the old one.
 */
async function click(window: Page, x: number, y: number) {
  await window.mouse.click(x, y);
  await window.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 50))),
  );
}

async function drag(window: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await window.mouse.move(from.x, from.y);
  await window.mouse.down();
  await window.mouse.move(to.x, to.y, { steps: 8 });
  await window.mouse.up();
}

test("a drag or click in the margins around the note's text acts on the nearest text", async ({
  loam,
}) => {
  const { window } = loam;
  await createThreeLineNote(window);
  const paper = (await window.getByTestId("notes-document-paper").boundingBox())!;
  const second = await lineBox(window, 1);
  const third = await lineBox(window, 2);

  // From the canvas left of the second line to the middle of the third.
  await drag(
    window,
    { x: paper.x - 20, y: second.y + second.height / 2 },
    { x: third.x + 30, y: third.y + third.height / 2 },
  );
  await expect.poll(() => selectedText(window)).toMatch(new RegExp(`^${LINES[1]}\nT\\w+$`));

  // From the empty paper below the last block up into the second line.
  await drag(
    window,
    { x: paper.x + 100, y: third.y + third.height + 200 },
    { x: second.x + 1, y: second.y + second.height / 2 },
  );
  await expect.poll(() => selectedText(window)).toBe(`${LINES[1]}\n${LINES[2]}`);

  // Shift+click on the canvas extends from the caret.
  await click(window, second.x + 600, second.y + second.height / 2);
  await window.keyboard.down("Shift");
  await window.mouse.click(paper.x + paper.width + 20, third.y + third.height / 2);
  await window.keyboard.up("Shift");
  await expect.poll(() => selectedText(window)).toBe(`\n${LINES[2]}`);

  // A click on the canvas puts the caret at the nearest line, ready to type.
  await click(window, paper.x - 20, second.y + second.height / 2);
  await window.keyboard.type("Then ");
  await expect.poll(() => lineTexts(window)).toEqual([LINES[0], `Then ${LINES[1]}`, LINES[2]]);
  await expectSaved(window, "Lines", `Then ${LINES[1]}`);
});

test("select all takes the line first, then the note, and never the window around it", async ({
  loam,
}) => {
  const { window } = loam;
  await createThreeLineNote(window);
  const second = await lineBox(window, 1);
  await click(window, second.x + 20, second.y + second.height / 2);

  await window.keyboard.press("ControlOrMeta+A");
  await expect.poll(() => selectedText(window)).toBe(LINES[1]);
  await window.keyboard.press("ControlOrMeta+A");
  await expect.poll(() => selectedText(window)).toBe(LINES.join("\n"));

  // Typing over the first press's selection replaces only that line.
  await click(window, second.x + 20, second.y + second.height / 2);
  await window.keyboard.press("ControlOrMeta+A");
  await window.keyboard.type("Replaced");
  await expect.poll(() => lineTexts(window)).toEqual([LINES[0], "Replaced", LINES[2]]);
  await expectSaved(window, "Lines", "Replaced");

  // Outside the editor and text fields, nothing new is selected: no sidebar rows or labels.
  await window.evaluate(() => document.getSelection()?.removeAllRanges());
  await noteRow(window, "Lines").focus();
  await window.keyboard.press("ControlOrMeta+A");
  expect(await selectedText(window)).toBe("");
});
