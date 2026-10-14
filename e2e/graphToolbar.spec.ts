import { expect, test } from "./app";
import { createNote } from "./notes";

test("drag shapes, edit the selection, and find nodes with the compact toolbar", async ({
  loam,
}) => {
  const window = loam.window;
  await loam.setWindowSize(1600, 900);
  await createNote(window, { title: "Project flow", body: "Capture ideas and connect them." });
  const main = window.getByRole("main");
  await main.getByRole("button", { name: "Add tab" }).click();
  await window.getByRole("menuitem", { name: "Graph tab" }).click();
  const graph = main.getByRole("region", { name: "Note graph canvas" });
  const toolbar = graph.getByTestId("note-graph-toolbar");
  const nodes = graph.locator(".react-flow__node");
  const pane = graph.locator(".react-flow__pane");

  await expect(nodes).toHaveCount(1);
  await nodes.first().click();
  await window.keyboard.press("Delete");
  await expect(nodes).toHaveCount(0);
  await expect(toolbar.getByRole("textbox")).toHaveCount(0);
  await expect(toolbar.getByRole("button", { name: "Filter nodes" })).toHaveCount(0);
  await expect(toolbar.getByRole("button", { name: "Zoom in" })).toHaveCount(0);
  await expect(toolbar.getByRole("button", { name: "Duplicate selection" })).toHaveCount(0);

  await toolbar.getByRole("button", { name: "Process", exact: true }).dragTo(pane, {
    targetPosition: { x: 240, y: 180 },
  });
  await expect(nodes).toHaveCount(1);
  await nodes.first().click();
  await loam.window.keyboard.press("Enter");
  const title = graph.getByRole("textbox", { name: "Node title", exact: true });
  await title.fill("Capture idea");
  await title.press("Enter");
  const selection = graph.getByRole("toolbar", { name: "Selection actions" });
  await selection.getByRole("button", { name: "Duplicate selection" }).click();
  await expect(nodes).toHaveCount(2);
  await graph.getByRole("button", { name: "Fit view" }).click();
  await nodes.last().click();
  await selection.getByRole("button", { name: "Delete selection" }).click();
  await expect(nodes).toHaveCount(1);

  await graph.focus();
  await window.keyboard.press("ControlOrMeta+f");
  const find = graph.getByRole("search", { name: "Find in graph" });
  const query = find.getByRole("textbox", { name: "Search nodes (Ctrl+F, Enter jumps)" });
  await expect(query).toBeFocused();
  await query.fill("Capture");
  await query.press("Enter");
  await expect(find).toContainText("1/1");
  await find.getByRole("button", { name: "Filter nodes" }).click();
  await window.getByRole("menuitemcheckbox", { name: "Decision", exact: true }).click();
  await expect(nodes.first()).toHaveClass(/note-graph-node-dimmed/);
  await query.focus();
  await query.press("Escape");
  await expect(find).toHaveCount(0);
  await expect(nodes.first()).not.toHaveClass(/note-graph-node-dimmed|note-graph-node-highlighted/);
  await expect(graph).toBeFocused();

  await toolbar.getByRole("button", { name: "Graph options" }).click();
  await window.getByRole("button", { name: "Find in graph", exact: true }).click();
  await expect(query).toBeFocused();
  await find.getByRole("button", { name: "Close find in graph" }).click();
  await toolbar.getByRole("button", { name: "Graph options" }).click();
  await window.getByRole("button", { name: "Canvas", exact: true }).click();
  await window.getByRole("menuitemcheckbox", { name: "Lines", exact: true }).click();
  await window.getByRole("button", { name: "Canvas", exact: true }).click();
  await window.getByRole("menuitemcheckbox", { name: "Dots", exact: true }).click();
  await window.keyboard.press("Escape");
  await pane.click({ position: { x: 800, y: 480 } });
  await expect(selection).toHaveCount(0);
  await graph.getByRole("button", { name: "Fit view" }).click();
  await expect(graph.getByRole("toolbar", { name: "Note graph zoom controls" })).toBeVisible();
  await expect(graph.getByRole("status")).toHaveText("");
});
