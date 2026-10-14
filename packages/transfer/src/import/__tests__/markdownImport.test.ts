// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import type { BridgeImportImageRequest, BridgeImportNote } from "@loam/shared/bridge/loamBridge";

import {
  blocksOf,
  byTitle,
  createEditor,
  createIdCounter,
  importFile as file,
  linksOf,
  textOf,
} from "../../__tests__/testKit";
import { convertMarkdownImport } from "../markdownImport";
import { rewriteObsidianMarkdown } from "../obsidianSyntax";

const editor = createEditor();
const createId = createIdCounter();

const PLAN_ID = "5d3c1a2b-7f4e-4c6d-9a8b-1e2f3a4b5c6d";
const VIDEO = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

const vault = [
  file(
    "Index.md",
    [
      "---",
      "title: Start here",
      "aliases:",
      "  - Home",
      "---",
      "Read [[Ideas]], [[Projects/Plan|the plan]] and [[Missing note]].",
      "",
      "Also [the plan file](Projects/Plan.md) and [a site](https://example.com).",
      "",
      "Code stays: `[[not a link]]`",
      "",
      "```",
      "[[also not a link]]",
      "```",
      "",
      "![[diagram.png]]",
      "",
      "![photo](images/photo%20one.jpg)",
      "",
      "![gone](images/gone.png)",
      "",
      "![remote](https://example.com/x.png)",
    ].join("\n"),
  ),
  file("Ideas.md", "# Ideas\n\nSome text."),
  file("Projects/Plan.md", `---\nloam-id: "${PLAN_ID}"\n---\nBack to [[Index]] and [[Home]].\n`),
  file("Projects/Sub/Deep.md", "See [[../Plan]]."),
  file(
    "Video.md",
    `---\nvideo: "${VIDEO}"\n---\n[At one minute](${VIDEO}&t=60s) and [another video](https://youtu.be/abcdefghijk?t=5).`,
  ),
  file(
    "Board.canvas",
    JSON.stringify({
      nodes: [
        { id: "a", type: "text", text: "Start", x: 0, y: 0, width: 200, height: 60 },
        { id: "b", type: "text", text: "End", x: 300, y: 0, width: 200, height: 60 },
      ],
      edges: [{ id: "e", fromNode: "a", toNode: "b", label: "then" }],
    }),
  ),
  file("Broken.canvas", "{ not json"),
  file("readme.txt", "plain text"),
];

const fakeImages = (requests: BridgeImportImageRequest[]) =>
  Promise.resolve(
    requests.map((request) =>
      request.reference === "diagram.png" || request.reference === "images/photo one.jpg"
        ? { url: `loam-media://images/${request.reference.length}.png` }
        : { skipped: "File not found" },
    ),
  );

const runImport = async (files = vault) => {
  const requests: BridgeImportImageRequest[] = [];
  const output = await convertMarkdownImport({
    files,
    createId,
    parseMarkdown: (markdown) => editor.tryParseMarkdownToBlocks(markdown),
    saveImages: (batch) => {
      requests.push(...batch);
      return fakeImages(batch);
    },
  });
  return { ...output, requests };
};

const plainText = (note: BridgeImportNote) => blocksOf(note).map(textOf).join("\n");

describe("rewriteObsidianMarkdown", () => {
  it("turns wikilinks and embeds into links, leaving code alone", () => {
    expect(
      rewriteObsidianMarkdown(
        "[[A]] [[B#Part|alias]] ![[pic.png|300]] ![[Other note]] `[[code]]`\n```\n[[fenced]]\n```",
      ),
    ).toBe(
      "[A](<loam-import-note:A>) [alias](<loam-import-note:B%23Part>) " +
        "![](<loam-import-image:pic.png>) [Other note](<loam-import-note:Other%20note>) `[[code]]`\n" +
        "```\n[[fenced]]\n```",
    );
  });

  it("shows heading links like Obsidian and escapes brackets in labels", () => {
    expect(rewriteObsidianMarkdown("[[Note#Heading]] [[x|a [b]]]")).toBe(
      "[Note > Heading](<loam-import-note:Note%23Heading>) [[x|a [b]]]",
    );
  });
});

describe("convertMarkdownImport", () => {
  it("creates one note per Markdown file with titles, folders and fresh ids", async () => {
    const { notes, skipped } = await runImport();

    expect(notes.map((note) => [note.title, note.folder]).sort()).toEqual(
      [
        ["Board", null],
        ["Deep", "Projects / Sub"],
        ["Ideas", null],
        ["Plan", "Projects"],
        ["Start here", null],
        ["Video", null],
      ].sort(),
    );
    expect(byTitle(notes, "Plan").id).not.toBe(PLAN_ID);
    expect(new Set(notes.map((note) => note.id)).size).toBe(notes.length);
    expect(skipped).toEqual(
      expect.arrayContaining([
        { path: "Broken.canvas", reason: "Not a valid canvas file" },
        { path: "readme.txt", reason: "Not a Markdown file" },
        { path: "Index.md: images/gone.png", reason: "File not found" },
      ]),
    );
  });

  it("resolves wikilinks, aliases, paths and relative links to note links", async () => {
    const { notes } = await runImport();
    const id = (title: string) => `/notes?noteId=${byTitle(notes, title).id}`;

    expect(linksOf(byTitle(notes, "Start here"))).toEqual([
      ["Ideas", id("Ideas")],
      ["the plan", id("Plan")],
      ["the plan file", id("Plan")],
      ["a site", "https://example.com"],
      ["Image: remote", "https://example.com/x.png"],
    ]);
    // The missing note's label stays as plain text.
    expect(plainText(byTitle(notes, "Start here"))).toContain("and Missing note.");
    expect(linksOf(byTitle(notes, "Plan"))).toEqual([
      ["Index", id("Start here")],
      ["Home", id("Start here")],
    ]);
    expect(linksOf(byTitle(notes, "Deep"))).toEqual([["../Plan", id("Plan")]]);
    // Code is left untouched.
    expect(plainText(byTitle(notes, "Start here"))).toContain("Code stays: [[not a link]]");
    expect(plainText(byTitle(notes, "Start here"))).toContain("[[also not a link]]");
  });

  it("copies local images and turns web or missing images into text", async () => {
    const { notes, requests } = await runImport();
    expect(requests).toEqual([
      { fromPath: "Index.md", reference: "diagram.png" },
      { fromPath: "Index.md", reference: "images/photo one.jpg" },
      { fromPath: "Index.md", reference: "images/gone.png" },
    ]);
    const blocks = blocksOf(byTitle(notes, "Start here"));
    expect(
      blocks.filter((block) => block.type === "image").map((block) => block.props.url),
    ).toEqual(["loam-media://images/11.png", "loam-media://images/20.png"]);
    const text = plainText(byTitle(notes, "Start here"));
    expect(text).toContain("Image not found: images/gone.png");
    // The web image is not loaded; it becomes a link to itself.
    expect(
      blocks.some(
        (block) => block.type === "image" && block.props.url === "https://example.com/x.png",
      ),
    ).toBe(false);
    expect(linksOf(byTitle(notes, "Start here"))).toContainEqual([
      "Image: remote",
      "https://example.com/x.png",
    ]);
  });

  it("keeps the video and turns its timestamps into in-app links", async () => {
    const { notes } = await runImport();
    const note = byTitle(notes, "Video");
    expect(note.video).toEqual({ url: VIDEO, videoId: "dQw4w9WgXcQ" });
    expect(linksOf(note)).toEqual([
      ["At one minute", "#note-video?t=60"],
      ["another video", "https://youtu.be/abcdefghijk?t=5"],
    ]);
  });

  it("imports canvas files as diagram notes", async () => {
    const { notes } = await runImport();
    const board = byTitle(notes, "Board");
    expect(board.tabs).toEqual([{ id: board.activeTabId, title: "Diagram", kind: "graph" }]);
    const graph = board.graphsByTab?.[board.activeTabId];
    expect(graph?.nodes.map((node) => node.title)).toEqual(["Start", "End"]);
    expect(graph?.edges.map((edge) => edge.label)).toEqual(["then"]);
    // The layout is kept but moved into the default view.
    expect(graph?.nodes.map((node) => node.position)).toEqual([
      { x: 80, y: 120 },
      { x: 380, y: 120 },
    ]);
  });
});
