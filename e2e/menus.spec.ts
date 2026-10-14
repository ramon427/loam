import type { Locator, Page } from "@playwright/test";

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

/** How a menu, menu row or tooltip looks, apart from its size. */
const lookOf = (locator: Locator) =>
  locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      border: `${style.borderTopWidth} ${style.borderTopColor}`,
      radius: style.borderRadius,
      font: `${style.fontSize} ${style.fontWeight}`,
      padding: `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom}`,
    };
  });
/** Hovers `target` afresh until `shown` appears, for what a passing focus change can close. */
const hoverUntilVisible = (window: Page, target: Locator, shown: Locator) =>
  expect(async () => {
    await window.mouse.move(0, 0);
    await target.hover();
    await expect(shown).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15_000 });
const heightOf = async (locator: Locator) => Math.round((await locator.boundingBox())!.height);

test("the editor's menus and tooltips look like the app's", async ({ loam }) => {
  const { window } = loam;
  await createNote(window, { title: "Look", body: "Words to format." });

  // The new note takes the focus a moment later, which closes a tooltip on its way.
  await hoverUntilVisible(
    window,
    window.getByRole("button", { name: "New note" }).first(),
    window.getByRole("tooltip"),
  );
  const appTooltip = await lookOf(window.getByRole("tooltip"));
  await noteRow(window, "Look").click({ button: "right" });
  const appMenu = window.getByRole("menu");
  const menu = await lookOf(appMenu);
  const row = await lookOf(appMenu.getByRole("menuitem").first());
  const rowHeight = await heightOf(appMenu.getByRole("menuitem").first());
  await window.keyboard.press("Escape");
  const asMenu = (look: typeof menu) => ({ ...look, font: menu.font });
  const asRow = (look: typeof row) => ({ ...look, background: row.background });

  // A formatting button names its shortcut in the app's own tooltip.
  await noteBody(window).getByText("Words to format.").dblclick();
  await window.locator(".bn-formatting-toolbar").getByRole("button").nth(1).hover();
  const tooltip = window.getByRole("tooltip");
  await expect(tooltip).toHaveText(/^\w[\w ]* \(.+\)$/);
  expect(await lookOf(tooltip)).toEqual(appTooltip);

  // Every block type fits on one row, with nothing drawn over its name.
  await window.locator(".bn-formatting-toolbar").getByRole("combobox").click();
  const blockTypes = window.getByRole("listbox");
  expect(asMenu(await lookOf(blockTypes))).toEqual(menu);
  for (const option of await blockTypes.getByRole("option").all()) {
    expect(asRow(await lookOf(option))).toEqual(row);
    expect(await heightOf(option)).toBe(rowHeight);
  }
  await window.keyboard.press("Escape");

  // The block menu's handle shows once the formatting toolbar has gone.
  await noteBody(window).getByText("Words to format.").click();
  await expect(window.locator(".bn-formatting-toolbar")).toHaveCount(0);
  await window.getByRole("button", { name: "Open block menu" }).click();
  const blockMenu = window.getByRole("menu");
  expect(asMenu(await lookOf(blockMenu))).toEqual(menu);
  expect(await lookOf(blockMenu.getByRole("menuitem", { name: "Delete" }))).toEqual(row);
  const colors = window.locator("[data-loam-block-color-menu]");
  await hoverUntilVisible(window, blockMenu.getByRole("menuitem", { name: "Colors" }), colors);
  expect(asMenu(await lookOf(colors))).toEqual(menu);
  expect(asRow(await lookOf(colors.getByRole("menuitemcheckbox").first()))).toEqual(row);
});
