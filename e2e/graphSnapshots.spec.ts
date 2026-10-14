import { DESKTOP, expect, test } from "./app";
import { createNote, noteBody, openNote, storedNote } from "./notes";
import type { Page } from "@playwright/test";

async function selectSnapshotArea(window: Page, reverse = false) {
  await window.getByRole("button", { name: "Capture graph snapshot" }).click();
  const capture = window.locator("[data-graph-snapshot-capture]");
  await expect(capture).toBeVisible();
  const box = (await capture.boundingBox())!;
  const start = { x: box.x + 12, y: box.y + 12 };
  const end = { x: box.x + box.width - 12, y: box.y + box.height - 65 };
  await window.mouse.move(reverse ? end.x : start.x, reverse ? end.y : start.y);
  await window.mouse.down();
  await window.mouse.move(reverse ? start.x : end.x, reverse ? start.y : end.y, { steps: 12 });
  await window.mouse.up();
  await expect(
    window.getByText("Live snapshot ready. Insert it here or copy it to another note."),
  ).toBeVisible();
}

test("capture, insert, update, and reopen a live graph snapshot", async ({ loam }, testInfo) => {
  await createNote(loam.window, { title: "Snapshot course", body: "Overview." });
  const main = loam.window.getByRole("main");
  await main.getByRole("button", { name: "Add tab" }).click();
  await loam.window.getByRole("menuitem", { name: "Graph tab" }).click();
  await expect(main.locator(".react-flow__node")).toHaveCount(1);
  await main.getByRole("button", { name: "Capture graph snapshot" }).click();
  await loam.window.keyboard.press("Escape");
  await expect(main.locator("[data-graph-snapshot-capture]")).toHaveCount(0);
  await expect(main.locator(".react-flow__node")).toHaveCount(1);
  await selectSnapshotArea(loam.window);
  await loam.window.getByRole("button", { name: "Insert into note", exact: true }).click();
  const snapshot = main.locator("[data-graph-snapshot]");
  await expect(snapshot).toBeVisible();
  await expect(snapshot.locator("svg[role=img]")).toHaveAttribute("viewBox", /.+/);
  await expect(snapshot).toHaveAttribute("contenteditable", "false");
  await expect(snapshot.locator(".react-flow")).toHaveCount(0);
  const bounds = await snapshot.locator("svg[role=img]").getAttribute("viewBox");
  await expect(noteBody(loam.window)).toBeFocused();
  await loam.window.keyboard.type("Writing continues below the snapshot.");
  await expect(noteBody(loam.window)).toContainText("Writing continues below the snapshot.");
  await expect(snapshot).not.toContainText("Writing continues below the snapshot.");

  await snapshot.getByRole("button", { name: "Open source graph" }).click();
  await main.locator(".react-flow__node").first().click();
  await loam.window.keyboard.press("Enter");
  const title = main.getByRole("textbox", { name: "Node title", exact: true });
  await title.fill("Updated in the graph");
  await title.press("Enter");
  const current = await storedNote(loam.window, "Snapshot course");
  const pageTab = current!.tabs.find((tab) => tab.kind === "page")!;
  await main.getByRole("button", { name: pageTab.title, exact: true }).click();
  await expect(snapshot).toContainText("Updated in the graph");
  await expect(snapshot.locator("svg[role=img]")).toHaveAttribute("viewBox", bounds!);
  await loam.window.screenshot({ path: testInfo.outputPath("live-graph-snapshot.png") });
  await expect
    .poll(async () =>
      JSON.stringify((await storedNote(loam.window, "Snapshot course"))?.blocksByTab),
    )
    .toContain("graphSnapshot");
  await loam.restart();
  await openNote(loam.window, "Snapshot course");
  await expect(loam.window.locator("[data-graph-snapshot]")).toContainText("Updated in the graph");
});

test(
  "copy a snapshot into another note and keep it live after source edits",
  DESKTOP,
  async ({ loam }) => {
    await createNote(loam.window, { title: "Destination", body: "Paper." });
    await createNote(loam.window, { title: "Source graph", body: "Source." });
    const main = loam.window.getByRole("main");
    await main.getByRole("button", { name: "Add tab" }).click();
    await loam.window.getByRole("menuitem", { name: "Graph tab" }).click();
    await selectSnapshotArea(loam.window, true);
    await loam.window.getByRole("button", { name: "Copy snapshot", exact: true }).click();
    await expect(loam.window.locator("[data-graph-snapshot-capture]")).toHaveCount(0);
    await openNote(loam.window, "Destination");
    await noteBody(loam.window).click();
    await loam.window.keyboard.press("ControlOrMeta+End");
    await loam.window.keyboard.press("Enter");
    await loam.window.keyboard.press("ControlOrMeta+V");
    const snapshot = main.locator("[data-graph-snapshot]");
    await expect(snapshot).toBeVisible();
    await expect(noteBody(loam.window)).not.toContainText("loam-graph-snapshot:");

    await openNote(loam.window, "Source graph");
    const source = await storedNote(loam.window, "Source graph");
    const sourcePageTab = source!.tabs.find((tab) => tab.kind === "page")!;
    await main.getByRole("button", { name: sourcePageTab.title, exact: true }).click();
    await openNote(loam.window, "Destination");
    await snapshot.getByRole("button", { name: "Open source graph" }).click();
    await expect(main.getByRole("region", { name: "Note graph canvas" })).toBeVisible();
    await main.locator(".react-flow__node").first().click();
    await loam.window.keyboard.press("Enter");
    const title = main.getByRole("textbox", { name: "Node title", exact: true });
    await title.fill("Changed source idea");
    await title.press("Enter");
    await openNote(loam.window, "Destination");
    await expect(snapshot).toContainText("Changed source idea");
    await loam.restart();
    await openNote(loam.window, "Destination");
    await expect(loam.window.locator("[data-graph-snapshot]")).toContainText("Changed source idea");
  },
);

test("an empty-area snapshot shows ideas added later", async ({ loam }) => {
  await createNote(loam.window, { title: "Empty area", body: "Notes." });
  const main = loam.window.getByRole("main");
  await main.getByRole("button", { name: "Add tab" }).click();
  await loam.window.getByRole("menuitem", { name: "Graph tab" }).click();
  await main.locator(".react-flow__node").first().click();
  await loam.window.keyboard.press("Delete");
  await expect(main.locator(".react-flow__node")).toHaveCount(0);
  await selectSnapshotArea(loam.window);
  await loam.window.getByRole("button", { name: "Insert into note", exact: true }).click();
  const snapshot = main.locator("[data-graph-snapshot]");
  await expect(snapshot).toBeVisible();
  await expect(snapshot.locator("[data-snapshot-node]")).toHaveCount(0);
  await snapshot.getByRole("button", { name: "Open source graph" }).click();
  await main.getByRole("button", { name: "Process", exact: true }).click();
  await main.locator(".react-flow__node").first().click();
  await loam.window.keyboard.press("Enter");
  const title = main.getByRole("textbox", { name: "Node title", exact: true });
  await title.fill("New idea in the empty area");
  await title.press("Enter");
  const stored = await storedNote(loam.window, "Empty area");
  const pageTab = stored!.tabs.find((tab) => tab.kind === "page")!;
  await main.getByRole("button", { name: pageTab.title, exact: true }).click();
  await expect(snapshot).toContainText("New idea in the empty area");
});
