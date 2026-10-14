import { expect, test } from "./app";
import { createNote, dropIndicator, holdDragOver, openNote, storedNote } from "./notes";

test("graph and table tabs are saved with their content", async ({ loam }) => {
  await createNote(loam.window, { title: "Course", body: "Overview." });
  const main = loam.window.getByRole("main");
  await main.getByRole("button", { name: "Add tab" }).click();
  await loam.window.getByRole("menuitem", { name: "Graph tab" }).click();
  // A new graph starts with one node; add a second.
  await main.getByRole("button", { name: "Process" }).click();
  await main.getByRole("button", { name: "Add tab" }).click();
  await loam.window.getByRole("menuitem", { name: "Table tab" }).click();
  await main.getByRole("button", { name: "Row", exact: true }).click();

  const expectStoredTabs = () =>
    expect
      .poll(async () => {
        const note = await storedNote(loam.window, "Course");
        return {
          kinds: note?.tabs.map((tab) => tab.kind),
          graphNodes: Object.values(note?.graphsByTab ?? {})[0]?.nodes.length,
          tableRows: Object.values(note?.tablesByTab ?? {})[0]?.rows.length,
        };
      })
      .toEqual({ kinds: ["page", "graph", "table"], graphNodes: 2, tableRows: 2 });
  await expectStoredTabs();

  await loam.restart();
  await openNote(loam.window, "Course");
  await loam.window.getByRole("main").getByRole("button", { name: "Graph" }).click();
  await expect(loam.window.getByRole("region", { name: "Note graph canvas" })).toBeVisible();
  await expectStoredTabs();
});

test("a new Markdown tab keeps its file, and stays a Markdown tab", async ({ loam }) => {
  await createNote(loam.window, { title: "Course", body: "Overview." });
  const main = loam.window.getByRole("main");
  await main.getByRole("button", { name: "Add tab" }).click();
  await loam.window.getByRole("menuitem", { name: "Markdown tab" }).click();
  await expect(main.getByText("Untitled.md")).toBeVisible();

  const storedTabs = async () => {
    const note = await storedNote(loam.window, "Course");
    return {
      kinds: note?.tabs.map((tab) => tab.kind),
      files: Object.values(note?.filesByTab ?? {}).map((file) => file.name),
    };
  };
  await expect.poll(storedTabs).toEqual({ kinds: ["page", "markdown"], files: ["Untitled.md"] });

  // Older versions saved Text tabs as "markdown" too; this one has a file, so it isn't one.
  await loam.restart();
  await openNote(loam.window, "Course");
  await loam.window.getByRole("main").getByRole("button", { name: "Untitled" }).click();
  await expect(loam.window.getByRole("main").getByText("Untitled.md")).toBeVisible();
  expect(await storedTabs()).toEqual({ kinds: ["page", "markdown"], files: ["Untitled.md"] });
});

test("a graph takes text written anywhere on it", async ({ loam }) => {
  await createNote(loam.window, { title: "Draft", body: "Overview." });
  const main = loam.window.getByRole("main");
  await main.getByRole("button", { name: "Add tab" }).click();
  await loam.window.getByRole("menuitem", { name: "Graph tab" }).click();
  const pane = main.locator(".react-flow__pane");
  const box = (await pane.boundingBox())!;
  await pane.dblclick({ position: { x: box.width * 0.35, y: box.height * 0.7 } });
  await main.getByRole("textbox", { name: "Text content" }).fill("Read two chapters");
  await main.getByRole("textbox", { name: "Text content" }).blur();

  const savedText = async () => {
    const note = await storedNote(loam.window, "Draft");
    const graph = Object.values(note?.graphsByTab ?? {})[0];
    return graph?.nodes.find((node) => node.shape === "text")?.notes;
  };
  await expect.poll(savedText).toBe("Read two chapters");

  await loam.restart();
  await openNote(loam.window, "Draft");
  await loam.window.getByRole("main").getByRole("button", { name: "Graph", exact: true }).click();
  await expect(loam.window.getByRole("main").getByText("Read two chapters")).toBeVisible();
});

test("a board's cards are saved as the rows of its table", async ({ loam }) => {
  await createNote(loam.window, { title: "Plan", body: "Overview." });
  const main = loam.window.getByRole("main");
  await main.getByRole("button", { name: "Add tab" }).click();
  await loam.window.getByRole("menuitem", { name: "Board tab" }).click();
  const doing = main.getByRole("region", { name: "Doing" });
  await doing.getByRole("button", { name: "Add card" }).click();
  await doing.getByRole("textbox", { name: "New card in Doing" }).fill("Draft the essay");
  await doing.getByRole("textbox", { name: "New card in Doing" }).press("Enter");
  await expect(doing.getByText("Draft the essay")).toBeVisible();

  await expect
    .poll(async () => {
      const note = await storedNote(loam.window, "Plan");
      const table = Object.values(note?.tablesByTab ?? {})[0];
      const status = table?.columns.find((column) => column.id === table.groupColumnId);
      const doingId = status?.options?.find((option) => option.label === "Doing")?.id;
      return table?.rows.some(
        (row) =>
          Object.values(row.cells).includes("Draft the essay") && row.cells[status!.id] === doingId,
      );
    })
    .toBe(true);
});

test("dragging a tab shows a line where it will land", async ({ loam }) => {
  await createNote(loam.window, { title: "Course", body: "Overview." });
  const main = loam.window.getByRole("main");
  await main.getByRole("button", { name: "Add tab" }).click();
  await loam.window.getByRole("menuitem", { name: "Table tab" }).click();
  const target = main.getByRole("button", { name: "Table", exact: true });
  expect(await dropIndicator(target)).toBe("none");

  await holdDragOver(main.getByRole("button", { name: "Notes", exact: true }), target, "after");
  await expect.poll(() => dropIndicator(target)).not.toBe("none");
});

test("a table row's right-click menu inserts and deletes rows", async ({ loam }) => {
  await createNote(loam.window, { title: "Course", body: "Overview." });
  const main = loam.window.getByRole("main");
  await main.getByRole("button", { name: "Add tab" }).click();
  await loam.window.getByRole("menuitem", { name: "Table tab" }).click();
  const storedTopics = async () => {
    const note = await storedNote(loam.window, "Course");
    const table = Object.values(note?.tablesByTab ?? {})[0];
    const topic = table?.columns[0]?.id ?? "";
    return table?.rows.map((row) => row.cells[topic]);
  };

  await main.getByRole("gridcell", { name: "Course" }).click({ button: "right" });
  await loam.window.getByRole("menuitem", { name: "Insert row above" }).click();
  await expect.poll(storedTopics).toEqual(["", "Course"]);

  await main.getByRole("gridcell", { name: "Course" }).click({ button: "right" });
  await loam.window.getByRole("menuitem", { name: "Delete row" }).click();
  await expect.poll(storedTopics).toEqual([""]);
});
