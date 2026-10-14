import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { expect, test } from "./app";
import { buildDocx, buildPdf, writeFile } from "./files";
import { createNote, openNote, storedNote } from "./notes";

const scratch = (path: string) => {
  mkdirSync(path, { recursive: true });
  return path;
};

test("a PDF tab shows the PDF it was given, copied into the notes", async ({ loam }, testInfo) => {
  const pdf = writeFile(
    scratch(testInfo.outputPath("files")),
    "Lecture 3.pdf",
    buildPdf(["Osmosis moves water", "Diffusion moves solutes"]),
  );
  await createNote(loam.window, { title: "Biology", body: "Overview." });
  const main = loam.window.getByRole("main");
  await loam.answerFilePickers([pdf]);
  await main.getByRole("button", { name: "Add tab" }).click();
  await loam.window.getByRole("menuitem", { name: "PDF tab" }).click();

  await expect(main.getByRole("button", { name: "Lecture 3" })).toBeVisible();
  await expect(main.getByText("Page 1 of 2")).toBeVisible();
  await expect(main.getByText("Osmosis moves water")).toBeVisible();
  await expect
    .poll(async () => {
      const note = await storedNote(loam.window, "Biology");
      return Object.values(note?.filesByTab ?? {}).map((file) => [file.name, file.source.kind]);
    })
    .toEqual([["Lecture 3.pdf", "imported"]]);

  await loam.restart();
  await openNote(loam.window, "Biology");
  await loam.window.getByRole("main").getByRole("button", { name: "Lecture 3" }).click();
  await expect(loam.window.getByRole("main").getByText("Osmosis moves water")).toBeVisible();
});

test("a PDF tab can be read beside the note while writing", async ({ loam }, testInfo) => {
  const pdf = writeFile(
    scratch(testInfo.outputPath("files")),
    "Lecture 3.pdf",
    buildPdf(["Osmosis moves water"]),
  );
  await createNote(loam.window, { title: "Biology", body: "Overview." });
  const main = loam.window.getByRole("main");
  await loam.answerFilePickers([pdf]);
  await main.getByRole("button", { name: "Add tab" }).click();
  await loam.window.getByRole("menuitem", { name: "PDF tab" }).click();
  await expect(main.getByText("Page 1 of 1")).toBeVisible();

  await main.getByRole("button", { name: "Lecture 3" }).click({ button: "right" });
  await loam.window.getByRole("menuitem", { name: "Show beside the note" }).click();

  const beside = main.getByRole("complementary", { name: "Lecture 3, beside the note" });
  await expect(beside.getByText("Osmosis moves water")).toBeVisible();
  await expect(main.getByRole("button", { name: "Notes" })).toHaveAttribute("aria-pressed", "true");
  await expect(main.getByText("Overview.")).toBeVisible();

  // Choosing the tab brings it back into the note.
  await main.getByRole("button", { name: /^Lecture 3/ }).click();
  await expect(beside).toBeHidden();
  await expect(main.getByText("Osmosis moves water")).toBeVisible();
});

test("a Word tab shows the document's text", async ({ loam }, testInfo) => {
  const docx = writeFile(
    scratch(testInfo.outputPath("files")),
    "Essay.docx",
    await buildDocx(["Why cells need membranes"]),
  );
  await createNote(loam.window, { title: "Essay", body: "Draft." });
  const main = loam.window.getByRole("main");
  await loam.answerFilePickers([docx]);
  await main.getByRole("button", { name: "Add tab" }).click();
  await loam.window.getByRole("menuitem", { name: "Word tab" }).click();

  await expect(main.getByText("Why cells need membranes")).toBeVisible();
});

test("a file opened from the computer can be kept as a reference that stays linked", async ({
  loam,
}, testInfo) => {
  const path = writeFile(scratch(testInfo.outputPath("files")), "Reading list.md", "# Reading\n");
  await createNote(loam.window, { title: "Course", body: "Overview." });
  await loam.answerFilePickers([path]);
  await loam.window.keyboard.press("Control+O");

  const opened = loam.window.getByRole("region", { name: "Opened file Reading list.md" });
  await expect(opened.getByRole("textbox", { name: "Markdown" })).toContainText("# Reading");
  await opened.getByRole("button", { name: "Keep as reference" }).click();

  const main = loam.window.getByRole("main");
  await expect(loam.window.getByRole("heading", { name: "Reading list" })).toBeVisible();
  const linked = async () => {
    const note = await storedNote(loam.window, "Reading list");
    return Object.values(note?.filesByTab ?? {}).map((file) => [file.name, file.source.kind]);
  };
  await expect.poll(linked).toEqual([["Reading list.md", "referenced"]]);

  // Edits are written to the file where it is.
  const editor = main.getByRole("textbox", { name: "Markdown" });
  await editor.click();
  await loam.window.keyboard.press("Control+End");
  await loam.window.keyboard.type("- Campbell, chapter 7");
  await expect.poll(() => readFileSync(path, "utf8")).toBe("# Reading\n- Campbell, chapter 7");

  // A change made elsewhere shows in the tab.
  await new Promise((resolve) => setTimeout(resolve, 700));
  writeFileSync(path, "# Reading\n- Alberts, chapter 1");
  await expect(editor).toContainText("Alberts, chapter 1");
});

test("a Markdown tab keeps what is typed in the note, as Markdown", async ({ loam }) => {
  await createNote(loam.window, { title: "Plan", body: "Overview." });
  const main = loam.window.getByRole("main");
  await main.getByRole("button", { name: "Add tab" }).click();
  await loam.window.getByRole("menuitem", { name: "Markdown tab" }).click();
  const editor = main.getByRole("textbox", { name: "Markdown" });
  await editor.click();
  await loam.window.keyboard.type("# Week 1\n\n- Read **chapter 2**");

  const storedText = async () => {
    const note = await storedNote(loam.window, "Plan");
    const source = Object.values(note?.filesByTab ?? {})[0]?.source;
    return source?.kind === "text" ? source.text : null;
  };
  await expect.poll(storedText).toBe("# Week 1\n\n- Read **chapter 2**");

  await loam.restart();
  await openNote(loam.window, "Plan");
  await loam.window.getByRole("main").getByRole("button", { name: "Untitled" }).click();
  await expect(loam.window.getByRole("main").getByText("Read **chapter 2**")).toBeVisible();
});
