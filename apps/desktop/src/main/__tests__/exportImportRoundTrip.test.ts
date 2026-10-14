// @vitest-environment jsdom

import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createNote,
  createTestStore,
  noteId,
  noteLink,
  paragraph,
  text,
} from "@loam/storage/testing/storeFixtures";
import { createTempDirectories } from "@loam/storage/testing/tempDirectories";
import { createEditor, PNG_BASE64 } from "@loam/transfer/__tests__/testKit";
import { convertMarkdownImport } from "@loam/transfer/import/markdownImport";

import { exportNotesAsMarkdown } from "../markdownExport";
import { createMediaStore } from "../mediaStore";
import { createNotesImporter } from "../import/sessions";

const editor = createEditor();
const IMAGE = "11111111-1111-4111-8111-111111111111.png";
const PNG = Buffer.from(PNG_BASE64, "base64");
const VIDEO_ID = "dQw4w9WgXcQ";
const FOLDER = { id: "22222222-2222-4222-8222-222222222222", name: "Projects", position: 0 };

const tempDirectory = createTempDirectories("loam-roundtrip-");

const IDEAS_MARKDOWN = [
  "# Ideas",
  "Some **bold**, *italic*, ~~struck~~ and `code` with a [link](https://example.com).",
  "- one\n  - nested\n- two",
  "1. first\n2. second",
  "- [ ] open\n- [x] done",
  "> quoted",
  "```js\nconst x = 1;\n```",
  "| A | B |\n| --- | --- |\n| 1 | 2 |",
].join("\n\n");

const createRichNote = (
  store: Awaited<ReturnType<typeof createTestStore>>,
  id: string,
  note: Record<string, unknown>,
) => store.createNote({ id, graphsByTab: {}, tablesByTab: {}, ...note });

/** A library with formatting, links, a folder, a video, an image, a diagram and a table. */
const seedLibrary = async (mediaDirectory: string) => {
  const store = await createTestStore();
  writeFileSync(join(mediaDirectory, IMAGE), PNG);
  await createNote(store, noteId(1), {
    title: "Index",
    blocks: [
      paragraph(
        text("Read "),
        noteLink(noteId(2), "the ideas"),
        text(" and "),
        noteLink(noteId(3), "Study"),
        text("."),
      ),
    ],
  });
  await createNote(store, noteId(2), {
    title: "Ideas",
    blocks: editor.tryParseMarkdownToBlocks(IDEAS_MARKDOWN),
  });
  await createRichNote(store, noteId(3), {
    title: "Study",
    tabs: [
      { id: "t1", title: "Notes", kind: "page" },
      { id: "g1", title: "Flow", kind: "graph" },
    ],
    blocksByTab: {
      t1: [
        paragraph(text("Body")),
        {
          id: "img",
          type: "image",
          props: { url: `loam-media://images/${IMAGE}`, caption: "Chart" },
          content: undefined,
          children: [],
        },
      ],
      g1: [],
    },
    graphsByTab: {
      g1: {
        enabled: true,
        nodes: [
          { id: "a", title: "Start", shape: "process", position: { x: 0, y: 0 } },
          { id: "b", title: "End", shape: "terminator", position: { x: 240, y: 0 } },
        ],
        edges: [{ id: "e", source: "a", target: "b", label: "then" }],
      },
    },
    activeTabId: "t1",
  });
  await createRichNote(store, noteId(4), {
    title: "Video",
    tabs: [{ id: "t1", title: "Notes", kind: "page" }],
    blocksByTab: {
      t1: [
        paragraph(text("At "), {
          type: "link",
          href: "#note-video?t=60",
          content: [text("1:00")],
        } as never),
      ],
    },
    activeTabId: "t1",
    video: { url: `https://www.youtube.com/watch?v=${VIDEO_ID}`, videoId: VIDEO_ID },
  });
  await store.saveLayout({
    folders: [FOLDER],
    notes: [
      { id: noteId(1), folderId: null },
      { id: noteId(3), folderId: null },
      { id: noteId(4), folderId: null },
      { id: noteId(2), folderId: FOLDER.id },
    ],
  });
  return store;
};

const importInto = async (directory: string) => {
  const store = await createTestStore();
  const mediaDirectory = tempDirectory();
  const importer = createNotesImporter({
    store,
    media: createMediaStore(mediaDirectory),
  });
  const picked = await importer.pick("markdown", [directory], "window");
  if (picked.status !== "picked") throw new Error("Expected a picked import.");
  const { notes, skipped } = await convertMarkdownImport({
    files: picked.files,
    createId: randomUUID,
    parseMarkdown: (markdown) => editor.tryParseMarkdownToBlocks(markdown),
    saveImages: (requests) => importer.images(picked.sessionId, requests),
  });
  await importer.write(picked.sessionId, notes);
  await importer.finish(picked.sessionId);
  return { store, mediaDirectory, skipped: [...picked.skipped, ...skipped] };
};

const exportAll = async (
  store: Awaited<ReturnType<typeof createTestStore>>,
  mediaDirectory: string,
) =>
  (
    await exportNotesAsMarkdown({
      store,
      scope: { kind: "all" },
      parentDirectory: tempDirectory(),
      mediaDirectory,
    })
  ).directory;

/** A file without the lines that change on every save: its id and date. */
const readStable = (directory: string, path: string) =>
  readFileSync(join(directory, ...path.split("/")), "utf8")
    .split("\n")
    .filter((line) => !/^(?:loam-id|updated): /.test(line))
    .join("\n");

describe("export then import", () => {
  it("brings text notes back unchanged, with links, folders, video and images", async () => {
    const firstMedia = tempDirectory();
    const first = await exportAll(await seedLibrary(firstMedia), firstMedia);

    const imported = await importInto(first);
    expect(imported.skipped).toEqual([]);
    const second = await exportAll(imported.store, imported.mediaDirectory);

    for (const path of ["Index.md", "Projects/Ideas.md", "Video.md"]) {
      expect(readStable(second, path)).toBe(readStable(first, path));
    }
    expect(readStable(second, "Index.md")).toContain("[[Study]]");
    expect(readStable(second, "Video.md")).toContain(
      `[1:00](https://www.youtube.com/watch?v=${VIDEO_ID}&t=60s)`,
    );

    const bootstrap = await imported.store.getLibrary();
    expect(bootstrap.folders.map((folder) => folder.name)).toEqual(["Projects"]);
    // The image was copied into the new library and still shows in Study.
    expect(readdirSync(imported.mediaDirectory)).toHaveLength(1);
    expect(readStable(second, "Study.md")).toMatch(/!\[Chart\]\(attachments\/[0-9a-f-]{36}\.png\)/);
  });

  it("brings a diagram tab back as a diagram note", async () => {
    const firstMedia = tempDirectory();
    const first = await exportAll(await seedLibrary(firstMedia), firstMedia);
    const { store } = await importInto(first);

    const summary = (await store.getLibrary()).notes.find((note) => note.title === "Study - Flow");
    expect(summary).toBeDefined();
    const diagram = await store.getNote(summary!.id);
    const graph = diagram.graphsByTab?.[diagram.activeTabId];
    expect(graph?.nodes.map((node) => node.title)).toEqual(["Start", "End"]);
    expect(graph?.edges.map((edge) => edge.label)).toEqual(["then"]);
  });
});
