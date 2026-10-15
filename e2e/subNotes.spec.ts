import type { Locator } from "@playwright/test";

import { expect, test } from "./app";
import { createNote, holdDragOver, noteRow, sidebar, storedLibrary, storedText } from "./notes";

/** Drags `source` onto `target` and drops it there. */
async function dragOnto(source: Locator, target: Locator, half: "after" | "inside") {
  const drag = await holdDragOver(source, target, half);
  await target.dispatchEvent("drop", { dataTransfer: drag.dataTransfer, ...drag.point });
}

test("a sub-note sits inside its note, and dragged out stays linked from it", async ({ loam }) => {
  const { window } = loam;
  await createNote(window, { title: "Trip", body: "Plans for the trip." });

  await noteRow(window, "Trip").click({ button: "right" });
  await window.getByRole("menuitem", { name: "New sub-note", exact: true }).click();
  const title = window.getByRole("main").getByRole("heading", { level: 1 }).getByRole("textbox");
  await expect(title).toBeFocused();
  await title.fill("Packing list");

  const parentOf = async (name: string) => {
    const library = await storedLibrary(window);
    const parentId = library.notes.find((note) => note.title === name)?.parentNoteId;
    return library.notes.find((note) => note.id === parentId)?.title ?? null;
  };
  await expect.poll(() => parentOf("Packing list")).toBe("Trip");
  // The parent links its sub-note, under the sub-note's title.
  await expect.poll(async () => (await storedText(window, "Trip")) ?? "").toContain("Packing list");
  const tree = sidebar(window).getByRole("navigation", { name: "Notes" });
  await expect(tree.getByRole("button", { name: "Hide sub-notes of Trip" })).toBeVisible();

  // Dragged out beside its parent, it is a normal note, and the parent still links it.
  await dragOnto(noteRow(window, "Packing list"), noteRow(window, "Trip"), "after");
  await expect.poll(() => parentOf("Packing list")).toBeNull();
  await expect(tree.getByRole("button", { name: /sub-notes of Trip/ })).toHaveCount(0);
  expect(await storedText(window, "Trip")).toContain("Packing list");

  // Dropped onto the middle of a note, it goes inside again.
  await dragOnto(noteRow(window, "Packing list"), noteRow(window, "Trip"), "inside");
  await expect.poll(() => parentOf("Packing list")).toBe("Trip");
  await expect(noteRow(window, "Packing list")).toBeVisible();
});
