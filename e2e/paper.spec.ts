import { expect, test } from "./app";
import { createNote, noteBody, openNote, storedNote } from "./notes";

test("paper resizes with the pointer and keyboard and remembers both dimensions", async ({
  loam,
}) => {
  const paper = () => loam.window.getByTestId("notes-document-paper");
  const dimensions = async () => {
    const box = (await paper().boundingBox())!;
    return { width: Math.round(box.width), height: Math.round(box.height) };
  };
  await createNote(loam.window, { title: "Paper size", body: "Keep these words while resizing." });
  const saved = await storedNote(loam.window, "Paper size");
  await expect.poll(dimensions).toEqual({ width: 860, height: 1216 });

  const edge = loam.window.getByRole("separator", { name: "Resize paper width" });
  const edgeBox = (await edge.boundingBox())!;
  const x = edgeBox.x + edgeBox.width / 2;
  const y = edgeBox.y + 100;
  await loam.window.mouse.move(x, y);
  await loam.window.mouse.down();
  await loam.window.mouse.move(x - 80, y, { steps: 8 });
  await loam.window.mouse.up();
  await expect.poll(dimensions).toEqual({ width: 700, height: 1216 });

  const corner = loam.window.getByRole("button", { name: "Resize paper", exact: true });
  await corner.scrollIntoViewIfNeeded();
  const cornerBox = (await corner.boundingBox())!;
  const cornerX = cornerBox.x + cornerBox.width / 2;
  const cornerY = cornerBox.y + cornerBox.height / 2;
  await loam.window.mouse.move(cornerX, cornerY);
  await loam.window.mouse.down();
  await loam.window.mouse.move(cornerX + 40, cornerY - 180, { steps: 8 });
  await loam.window.mouse.up();
  await expect.poll(dimensions).toEqual({ width: 780, height: 1036 });
  await loam.window.keyboard.press("ArrowLeft");
  await loam.window.keyboard.press("Shift+ArrowUp");
  await expect.poll(dimensions).toEqual({ width: 770, height: 986 });
  expect(await storedNote(loam.window, "Paper size")).toEqual(saved);

  await loam.restart();
  await openNote(loam.window, "Paper size");
  await expect.poll(dimensions).toEqual({ width: 770, height: 986 });
  await expect(noteBody(loam.window)).toContainText("Keep these words while resizing.");
  await loam.window
    .getByRole("separator", { name: "Resize paper width" })
    .dblclick({ position: { x: 7, y: 100 } });
  await expect.poll(dimensions).toEqual({ width: 860, height: 1216 });
});

test("a smaller window or wider sidebar preserves the preferred paper width", async ({ loam }) => {
  await createNote(loam.window, { title: "Wide paper", body: "A wider writing area." });
  const paperWidth = async () =>
    Math.round((await loam.window.getByTestId("notes-document-paper").boundingBox())!.width);
  await loam.window.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect.poll(async () => (await loam.window.getByRole("main").boundingBox())!.x).toBe(0);
  const edge = loam.window.getByRole("separator", { name: "Resize paper width" });
  const box = (await edge.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + 100;
  await loam.window.mouse.move(x, y);
  await loam.window.mouse.down();
  await loam.window.mouse.move(x + 120, y, { steps: 8 });
  await loam.window.mouse.up();
  await expect.poll(paperWidth).toBe(1100);

  await loam.window.getByRole("button", { name: "Expand sidebar" }).click();
  await expect.poll(paperWidth).toBeLessThan(1100);
  await loam.setWindowSize(700, 760);
  await expect.poll(paperWidth).toBeLessThan(400);
  const paperBox = (await loam.window.getByTestId("notes-document-paper").boundingBox())!;
  const mainBox = (await loam.window.getByRole("main").boundingBox())!;
  expect(paperBox.x).toBeGreaterThanOrEqual(mainBox.x);
  expect(paperBox.x + paperBox.width).toBeLessThanOrEqual(mainBox.x + mainBox.width);

  // Changing height in a narrow window must keep the preferred width as well.
  await loam.window.getByRole("button", { name: "Resize paper", exact: true }).focus();
  await loam.window.keyboard.press("ArrowDown");
  await loam.setWindowSize(1280, 840);
  await loam.window.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect.poll(paperWidth).toBe(1100);
  await edge.focus();
  await loam.window.keyboard.press("Enter");
  await expect.poll(paperWidth).toBe(860);
});

test("Escape cancels a paper drag and shorter paper still fits a long note", async ({ loam }) => {
  await createNote(loam.window, { title: "Growing paper", body: "Start here." });
  const edge = loam.window.getByRole("separator", { name: "Resize paper width" });
  const box = (await edge.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + 100;
  await loam.window.mouse.move(x, y);
  await loam.window.mouse.down();
  await loam.window.mouse.move(x - 150, y, { steps: 8 });
  await expect(edge).toHaveAttribute("aria-valuenow", "560");
  await loam.window.keyboard.press("Escape");
  await loam.window.mouse.up();
  await expect(edge).toHaveAttribute("aria-valuenow", "860");
  await expect(loam.window.getByTestId("notes-document-canvas")).not.toHaveAttribute(
    "data-paper-resize-axis",
  );
  await loam.restart();
  await openNote(loam.window, "Growing paper");
  await expect(loam.window.getByRole("separator", { name: "Resize paper width" })).toHaveAttribute(
    "aria-valuenow",
    "860",
  );

  await loam.window.getByRole("button", { name: "Resize paper", exact: true }).focus();
  for (let i = 0; i < 16; i++) await loam.window.keyboard.press("Shift+ArrowUp");
  const paper = loam.window.getByTestId("notes-document-paper");
  await expect.poll(async () => Math.round((await paper.boundingBox())!.height)).toBe(480);
  const text = "A long note keeps all its words visible as the paper grows. ".repeat(250);
  await noteBody(loam.window).fill(text);
  await expect.poll(async () => (await paper.boundingBox())!.height).toBeGreaterThan(800);
  const paperBox = (await paper.boundingBox())!;
  const bodyBox = (await noteBody(loam.window).boundingBox())!;
  expect(bodyBox.y + bodyBox.height).toBeLessThanOrEqual(paperBox.y + paperBox.height);
  await expect(noteBody(loam.window)).toHaveText(text.trim());
});
