import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { expect, test } from "../app";
import { expectSaved, noteBody, openNote } from "../notes";
import { seedLibrary } from "./library";

/**
 * Builds the library for the cold test (cold-test.md), only when LOAM_COLD_TEST_DIR is set:
 * the 2,000 notes the flows use, one note with an older version to bring back, and an
 * "Old vault" Markdown folder to import. The facilitator then starts Loam on it.
 */
const target = process.env.LOAM_COLD_TEST_DIR;
test.skip(!target, "Set LOAM_COLD_TEST_DIR to build the cold-test library.");

test("prepare the cold-test library", async ({ loam }) => {
  const window = loam.window;
  await seedLibrary(window, 2000);

  // "Budget: roof 0" had a different first paragraph two hours ago.
  await loam.advanceClock(-2 * 60 * 60 * 1000);
  await openNote(window, "Budget: roof 0");
  const first = noteBody(window).locator(".bn-block-content").first();
  await first.click();
  await window.keyboard.press("Home");
  await window.keyboard.press("Shift+End");
  await window.keyboard.type("Roofer said 9,400 for the full job, scaffolding included.");
  await expectSaved(window, "Budget: roof 0", "9,400");
  await loam.advanceClock(2 * 60 * 60 * 1000);
  await first.click();
  await window.keyboard.press("Home");
  await window.keyboard.press("Shift+End");
  await window.keyboard.type("TODO");
  await expectSaved(window, "Budget: roof 0", "TODO");
  await expect(noteBody(window)).not.toContainText("9,400");
  await loam.quit();

  const root = resolve(target!);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  cpSync(loam.dataDirectory, join(root, "library"), { recursive: true });
  mkdirSync(join(root, "empty"));
  const vault = join(root, "Old vault");
  mkdirSync(join(vault, "Garden"), { recursive: true });
  writeFileSync(join(vault, "Seeds to order.md"), "# Seeds to order\n\n- Tomatoes\n- Basil\n");
  writeFileSync(join(vault, "Garden", "Compost.md"), "Turn it every two weeks.\n");
  writeFileSync(join(vault, "Garden", "Watering.md"), "Mornings only in July.\n");
  writeFileSync(join(vault, "Meeting minutes.docx"), "not a note");
});
