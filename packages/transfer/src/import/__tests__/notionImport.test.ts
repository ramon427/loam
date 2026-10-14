// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import type { BridgeImportImageRequest } from "@loam/shared/bridge/loamBridge";

import {
  blocksOf,
  byTitle,
  createEditor,
  createIdCounter,
  importFile,
  linksOf,
} from "../../__tests__/testKit";
import { cleanNotionName, convertNotionImport } from "../notionImport";

const editor = createEditor();
const createId = createIdCounter();

const HOME = "Home 0123456789abcdef0123456789abcdef";
const PLAN = "Plan 11111111111111111111111111111111";
const TASKS = "Tasks 22222222222222222222222222222222";
const WRITE = "Write 33333333333333333333333333333333";
const WIKI = "Wiki 44444444444444444444444444444444";
const encode = (path: string) => path.split("/").map(encodeURIComponent).join("/");

const file = (path: string, text: string) => importFile(`Export-abc/${path}`, text);

const exportFiles = [
  file(
    `${HOME}.md`,
    [
      "# Home",
      "",
      `See [Plan](${encode(`${HOME}/${PLAN}.md`)}) and [Tasks](${encode(`${HOME}/${TASKS}.csv`)}).`,
      "",
      "<aside>",
      "💡 A tip worth keeping",
      "</aside>",
      "",
      `![diagram.png](${encode(`${HOME}/diagram.png`)})`,
    ].join("\n"),
  ),
  file(`${HOME}/${PLAN}.md`, `# Plan\n\nBack to [Home](../${encode(`${HOME}.md`)}).`),
  file(`${HOME}/${TASKS}.csv`, "Name,Status\nWrite,Done\n"),
  file(`${HOME}/${TASKS}_all.csv`, 'Name,Status,Owner\nWrite,Done,Me\n"Ship, then rest",Open,\n'),
  file(`${HOME}/${TASKS}/${WRITE}.md`, "# Write\n\nStatus: Done"),
  file(
    `${WIKI}.html`,
    [
      "<html><body><article class='page'>",
      "<header><h1 class='page-title'>Wiki</h1>",
      "<table class='properties'><tr><th>Owner</th><td>Me</td></tr></table></header>",
      `<div class='page-body'><p>Hello <a href='${encode(`${HOME}.md`)}'>home</a></p>`,
      "<script>window.hacked = true</script></div>",
      "</article></body></html>",
    ].join(""),
  ),
  file("notes.txt", "stray"),
];

const runImport = async () => {
  const requests: BridgeImportImageRequest[] = [];
  const output = await convertNotionImport({
    files: exportFiles,
    createId,
    parseMarkdown: (markdown) => editor.tryParseMarkdownToBlocks(markdown),
    parseHtml: (html) => editor.tryParseHTMLToBlocks(html),
    saveImages: async (batch) => {
      requests.push(...batch);
      return batch.map(() => ({ url: "loam-media://images/diagram.png" }));
    },
  });
  return { ...output, requests };
};

describe("cleanNotionName", () => {
  it("drops Notion's id but keeps the rest of the name", () => {
    expect(cleanNotionName(HOME)).toBe("Home");
    expect(cleanNotionName("Plan 2024")).toBe("Plan 2024");
  });
});

describe("convertNotionImport", () => {
  it("keeps the page tree as folders, without ids or the export's wrapper folder", async () => {
    const { notes, skipped } = await runImport();
    expect(notes.map((note) => [note.title, note.folder])).toEqual([
      ["Home", null],
      ["Plan", "Home"],
      ["Tasks", "Home"],
      ["Write", "Home / Tasks"],
      ["Wiki", null],
    ]);
    expect(skipped).toEqual([{ path: "Export-abc/notes.txt", reason: "Not a Notion page" }]);
  });

  it("links pages and databases to each other", async () => {
    const { notes } = await runImport();
    const href = (title: string) => `/notes?noteId=${byTitle(notes, title).id}`;
    expect(linksOf(byTitle(notes, "Home"))).toEqual([
      ["Plan", href("Plan")],
      ["Tasks", href("Tasks")],
    ]);
    expect(linksOf(byTitle(notes, "Plan"))).toEqual([["Home", href("Home")]]);
    expect(linksOf(byTitle(notes, "Wiki"))).toEqual([["home", href("Home")]]);
  });

  it("drops the repeated title, turns callouts into quotes and copies images", async () => {
    const { notes, requests } = await runImport();
    const home = blocksOf(byTitle(notes, "Home"));
    expect(home[0]?.type).toBe("paragraph");
    expect(home.find((block) => block.type === "quote")?.content?.[0]?.text).toContain(
      "A tip worth keeping",
    );
    expect(requests).toEqual([
      { fromPath: `Export-abc/${HOME}.md`, reference: `${HOME}/diagram.png` },
    ]);
    expect(home.find((block) => block.type === "image")?.props.url).toBe(
      "loam-media://images/diagram.png",
    );
  });

  it("imports the complete database file as a table tab", async () => {
    const tasks = byTitle((await runImport()).notes, "Tasks");
    expect(tasks.tabs).toEqual([{ id: tasks.activeTabId, title: "Table", kind: "table" }]);
    const table = tasks.tablesByTab?.[tasks.activeTabId];
    expect(table?.columns.map((column) => column.title)).toEqual(["Name", "Status", "Owner"]);
    expect(table?.rows.map((row) => table.columns.map((column) => row.cells[column.id]))).toEqual([
      ["Write", "Done", "Me"],
      ["Ship, then rest", "Open", ""],
    ]);
  });

  it("reads HTML pages with their properties and without scripts", async () => {
    const wiki = blocksOf(byTitle((await runImport()).notes, "Wiki"));
    expect(wiki.some((block) => block.type === "table")).toBe(true);
    expect(JSON.stringify(wiki)).not.toContain("hacked");
    expect(wiki.some((block) => block.type === "heading")).toBe(false);
  });
});
