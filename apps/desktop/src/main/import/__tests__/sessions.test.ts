import { mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import type { BridgeImportNote, BridgeImportSource } from "@loam/shared/bridge/loamBridge";
import type { NotesStore } from "@loam/storage/NotesStore";
import { createTestStore, noteId, paragraph, text } from "@loam/storage/testing/storeFixtures";
import { createTempDirectories } from "@loam/storage/testing/tempDirectories";
import { PNG_BASE64 } from "@loam/transfer/__tests__/testKit";

import { createMediaStore, imageTypeOf } from "../../mediaStore";
import { IMPORT_LIMITS } from "../readers";
import { createNotesImporter } from "../sessions";
import { buildZip } from "./zipFixture";

const PNG = Buffer.from(PNG_BASE64, "base64");

const tempDirectory = createTempDirectories("loam-import-");

const writeTree = (root: string, files: Record<string, string | Buffer>) => {
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(root, ...path.split("/"));
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
  }
};

/** A folder (`vault`) holding `files`, and a folder beside it the import must not reach. */
const setup = async (
  files: Record<string, string | Buffer>,
  { beforeFirstWrite }: { beforeFirstWrite?: (store: NotesStore) => Promise<void> } = {},
) => {
  const vault = tempDirectory();
  const outside = tempDirectory();
  writeTree(vault, files);
  writeFileSync(join(outside, "secret.png"), PNG);
  const mediaDirectory = tempDirectory();
  const store = await createTestStore();
  let clock = 0;
  const importer = createNotesImporter({
    store,
    media: createMediaStore(mediaDirectory),
    ...(beforeFirstWrite && { beforeFirstWrite: () => beforeFirstWrite(store) }),
    now: () => clock,
  });
  return {
    vault,
    outside,
    store,
    importer,
    mediaDirectory,
    advance: (ms: number) => (clock += ms),
  };
};

/** Picks `paths` (one path or several) from the window and expects a session. */
const picked = async (
  importer: Awaited<ReturnType<typeof setup>>["importer"],
  paths: string | string[],
  source: BridgeImportSource = "markdown",
) => {
  const result = await importer.pick(source, [paths].flat(), "window");
  if (result.status !== "picked") throw new Error("Expected a picked import.");
  return result;
};

const note = (id: string, title: string, folder: string | null): BridgeImportNote => ({
  id,
  title,
  folder,
  tabs: [{ id: "tab-1", title: "Notes", kind: "page" }],
  blocksByTab: { "tab-1": [paragraph(text(title))] },
  activeTabId: "tab-1",
});

describe("imageTypeOf", () => {
  it("trusts the bytes, not the extension", () => {
    expect(imageTypeOf(new Uint8Array(PNG))).toBe("image/png");
    expect(imageTypeOf(new TextEncoder().encode("<svg></svg>"))).toBeNull();
  });
});

describe("notes importer", () => {
  it("keeps an AI import independent from UI picks and expects one folder", async () => {
    const { vault, importer } = await setup({ "Note.md": "A note" });
    const ui = await picked(importer, vault);
    const ai = await importer.pick("markdown", [vault], "ai");
    if (ai.status !== "picked") throw new Error("Expected an AI import session.");
    await picked(importer, vault);
    await expect(importer.images(ui.sessionId, [])).rejects.toMatchObject({
      code: "IMPORT_EXPIRED",
    });
    expect(await importer.images(ai.sessionId, [])).toEqual([]);
    await expect(importer.pick("markdown", [vault, vault], "ai")).rejects.toMatchObject({
      status: 400,
    });
    expect(await importer.finish(ai.sessionId)).toEqual({ noteCount: 0, folderCount: 0 });
  });
  it("reads note files, skipping app folders, links and other files", async () => {
    const { vault, outside, importer } = await setup({
      "Index.md": "# Index",
      "Projects/Plan.md": "plan",
      "Board.canvas": "{}",
      ".obsidian/workspace.md": "app settings",
      ".trash/Old.md": "deleted",
      "node_modules/pkg/README.md": "dependency",
      "Paper.pdf": "%PDF",
      "Big.md": "x".repeat(IMPORT_LIMITS.fileBytes + 1),
    });
    symlinkSync(outside, join(vault, "Linked"));

    const result = await picked(importer, vault);
    expect(result.files.map((file) => file.path)).toEqual([
      "Board.canvas",
      "Index.md",
      "Projects/Plan.md",
    ]);
    expect(result.skipped).toEqual([
      { path: "Big.md", reason: "Larger than 5 MB" },
      { path: "Linked", reason: "Links to other places are not followed" },
      { path: "Paper.pdf", reason: "Not a note file" },
    ]);
  });

  it("copies images by relative path, vault path or file name, and nothing outside", async () => {
    const { importer, mediaDirectory, vault } = await setup({
      "Notes/Day.md": "day",
      "Notes/pics/a.png": PNG,
      "attachments/b.png": PNG,
      "fake.png": "not really a png",
      "logo.svg": "<svg></svg>",
    });
    const { sessionId } = await picked(importer, vault);

    const results = await importer.images(sessionId, [
      { fromPath: "Notes/Day.md", reference: "pics/a.png" },
      { fromPath: "Notes/Day.md", reference: "attachments/b.png" },
      { fromPath: "Notes/Day.md", reference: "b.png" },
      { fromPath: "Notes/Day.md", reference: "./pics/a.png" },
      { fromPath: "Notes/Day.md", reference: "../../secret.png" },
      { fromPath: "Notes/Day.md", reference: "/etc/passwd" },
      { fromPath: "Notes/Day.md", reference: "fake.png" },
      { fromPath: "Notes/Day.md", reference: "logo.svg" },
    ]);

    const urls = results.map((result) => ("url" in result ? result.url : result.skipped));
    expect(urls[0]).toMatch(/^loam-media:\/\/images\/[0-9a-f-]{36}\.png$/);
    expect(urls[1]).toMatch(/^loam-media:\/\/images\//);
    // The same file is copied once and shared.
    expect(urls[2]).toBe(urls[1]);
    expect(urls[3]).toBe(urls[0]);
    expect(urls.slice(4)).toEqual([
      "Image file not found",
      "Image file not found",
      "Image type is not supported (use PNG, JPEG, GIF, WebP or AVIF)",
      "Image type is not supported (use PNG, JPEG, GIF, WebP or AVIF)",
    ]);
    expect(readdirSync(mediaDirectory)).toHaveLength(2);
  });

  it("skips an image that disappeared after the folder was read", async () => {
    const { vault, importer } = await setup({ "A.md": "a", "gone.png": PNG });
    const { sessionId } = await picked(importer, vault);
    rmSync(join(vault, "gone.png"));
    await expect(
      importer.images(sessionId, [{ fromPath: "A.md", reference: "gone.png" }]),
    ).resolves.toEqual([{ skipped: "Image file could not be read" }]);
  });

  it("writes notes in batches, then places them into folders once", async () => {
    const { importer, store, vault } = await setup({ "A.md": "a" });
    const { sessionId } = await picked(importer, vault);

    await expect(
      importer.write(sessionId, [note(noteId(1), "First", "Projects")]),
    ).resolves.toEqual({ written: 1 });
    await importer.write(sessionId, [note(noteId(2), "Second", null)]);
    // Notes exist before finish, at the top level until they are placed.
    expect((await store.getLibrary()).notes.every((entry) => !entry.folderId)).toBe(true);

    await expect(importer.finish(sessionId)).resolves.toEqual({ noteCount: 2, folderCount: 1 });
    const bootstrap = await store.getLibrary();
    expect(bootstrap.folders.map((folder) => folder.name)).toEqual(["Projects"]);
    expect(bootstrap.notes.find((entry) => entry.id === noteId(1))?.folderId).toBe(
      bootstrap.folders[0]!.id,
    );

    // A finished import can't be continued.
    await expect(importer.write(sessionId, [note(noteId(3), "Late", null)])).rejects.toMatchObject({
      code: "IMPORT_EXPIRED",
    });
  });

  it("runs the safety backup once, before the first note is written", async () => {
    const events: string[] = [];
    const { vault, importer } = await setup(
      { "A.md": "a" },
      {
        beforeFirstWrite: async (store) => {
          events.push(`backup with ${(await store.getLibrary()).notes.length} notes`);
        },
      },
    );
    const { sessionId } = await picked(importer, vault);
    await importer.write(sessionId, [note(noteId(1), "One", null)]);
    await importer.write(sessionId, [note(noteId(2), "Two", null)]);
    expect(events).toEqual(["backup with 0 notes"]);
  });

  it("expires abandoned imports and only accepts the latest pick", async () => {
    const { importer, advance, vault } = await setup({ "A.md": "a" });
    const first = await picked(importer, vault);
    const second = await picked(importer, vault);
    await expect(importer.images(first.sessionId, [])).rejects.toMatchObject({
      code: "IMPORT_EXPIRED",
    });
    advance(60 * 60 * 1000 + 1);
    await expect(importer.finish(second.sessionId)).rejects.toMatchObject({
      code: "IMPORT_EXPIRED",
    });
  });

  it("reads only the Evernote files picked, keeping names unique", async () => {
    const { vault, importer } = await setup({
      "first/Work.enex": "<en-export/>",
      "first/notes.txt": "x",
      "second/Work.enex": "<en-export></en-export>",
    });
    symlinkSync(join(vault, "first", "Work.enex"), join(vault, "second", "Linked.enex"));

    const result = await picked(
      importer,
      [
        "first/Work.enex",
        "second/Work.enex",
        "first/notes.txt",
        "second/Linked.enex",
        "second",
      ].map((path) => join(vault, path)),
      "evernote",
    );
    expect(result.name).toBe("5 files");
    expect(result.files.map((file) => [file.path, file.text])).toEqual([
      ["Work.enex", "<en-export/>"],
      ["Work (2).enex", "<en-export></en-export>"],
    ]);
    expect(result.skipped).toEqual([
      { path: "notes.txt", reason: "Not a note file" },
      { path: "Linked.enex", reason: "Not a file" },
      { path: expect.any(String), reason: "Not a file" },
    ]);
  });

  it("reads a Notion zip, including its part zips, and copies images from it", async () => {
    const part = buildZip([
      { name: "Home abc/Plan def.md", content: "# Plan", deflate: true },
      { name: "Home abc/chart.png", content: PNG },
    ]);
    const zip = buildZip([
      { name: "Home abc.md", content: "# Home", deflate: true },
      { name: "Export-Part-1.zip", content: part },
      { name: "__MACOSX/Home abc.md", content: "metadata" },
      { name: "Home abc/.DS_Store", content: "x" },
      { name: "Home abc/report.pdf", content: "%PDF" },
    ]);
    const { vault, importer, mediaDirectory } = await setup({ "Export.zip": zip });

    const result = await picked(importer, join(vault, "Export.zip"), "notion");
    expect(result.name).toBe("Export.zip");
    expect(result.files.map((entry) => [entry.path, entry.text])).toEqual([
      ["Home abc.md", "# Home"],
      ["Home abc/Plan def.md", "# Plan"],
    ]);
    expect(result.skipped).toEqual([{ path: "Home abc/report.pdf", reason: "Not a note file" }]);
    const [saved] = await importer.images(result.sessionId, [
      { fromPath: "Home abc.md", reference: "Home abc/chart.png" },
    ]);
    expect(saved).toMatchObject({ url: expect.stringMatching(/^loam-media:\/\/images\//) });
    expect(readdirSync(mediaDirectory)).toHaveLength(1);
  });

  it("tells which app's export was picked from the folder or files themselves", async () => {
    const { vault, importer } = await setup({
      "Ideas.md": "# Ideas",
      "Work/Standup.md": "Talk.",
      "Notebook.enex": "<en-export/>",
      "Export.zip": buildZip([{ name: "Page.md", content: "# Page" }]),
      "Saved.html": "<p>Saved</p>",
      "Minutes.docx": "x",
    });
    const sourceOf = async (...paths: string[]) => {
      const picked = await importer.pick("auto", paths, "window");
      return picked.status === "picked" ? picked.source : null;
    };
    expect(await sourceOf(vault)).toBe("markdown");
    expect(await sourceOf(join(vault, "Ideas.md"))).toBe("markdown");
    expect(await sourceOf(join(vault, "Notebook.enex"))).toBe("evernote");
    expect(await sourceOf(join(vault, "Export.zip"))).toBe("notion");
    expect(await sourceOf(join(vault, "Saved.html"))).toBe("html");
    // Markdown files picked one by one are read as files, not as a folder.
    const files = await importer.pick("auto", [join(vault, "Ideas.md")], "window");
    expect(files.status === "picked" && files.files.map((file) => file.path)).toEqual(["Ideas.md"]);
    // What Loam doesn't import says what it does.
    await expect(importer.pick("auto", [join(vault, "Minutes.docx")], "window")).rejects.toThrow(
      /Markdown or Obsidian folder/,
    );
    await expect(
      importer.pick("auto", [join(vault, "Ideas.md"), join(vault, "Notebook.enex")], "window"),
    ).rejects.toThrow(/Markdown or Obsidian folder/);
    await expect(importer.pick("auto", [vault, join(vault, "Work")], "window")).rejects.toThrow(
      "Import one folder at a time.",
    );
  });

  it("asks for the zip when something else is picked for Notion", async () => {
    const { importer, vault } = await setup({ "A.md": "a" });
    await expect(importer.pick("notion", [vault], "window")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("finds images for picked HTML files only inside each file's own folder", async () => {
    const { vault, outside, importer } = await setup({
      "Note.html": "<p>x</p>",
      "Note_files/photo one.png": PNG,
      "Note_files/100%25.png": PNG,
      "Note_files/notes.txt": "text",
    });
    symlinkSync(join(outside, "secret.png"), join(vault, "linked.png"));
    const result = await picked(importer, join(vault, "Note.html"), "html");

    const results = await importer.images(
      result.sessionId,
      [
        // References arrive decoded; a name with a literal "%25" is not decoded again.
        "Note_files/photo one.png",
        "Note_files/100%25.png",
        `../${outside.split("/").at(-1)}/secret.png`,
        join(outside, "secret.png"),
        "linked.png",
        "data:image/png;base64,AAAA",
        "Note_files/notes.txt",
      ].map((reference) => ({ fromPath: "Note.html", reference })),
    );
    expect(results.map((entry) => ("url" in entry ? "copied" : entry.skipped))).toEqual([
      "copied",
      "copied",
      "Image file not found",
      "Image file not found",
      "Image file not found",
      "Image file not found",
      "Image file not found",
    ]);
  });

  it("counts part zips against the archive's size before expanding them", async () => {
    const part = buildZip([{ name: "Page.md", content: "# Page" }]);
    const { vault, importer } = await setup({
      "Export.zip": buildZip([
        { name: "Part-1.zip", content: part },
        { name: "Part-2.zip", content: part, declaredSize: 1100 * 1024 * 1024 },
      ]),
    });
    await expect(picked(importer, join(vault, "Export.zip"), "notion")).rejects.toMatchObject({
      code: "IMPORT_TOO_LARGE",
    });
  });

  it("lists at most 500 skipped files from an archive and counts the rest", async () => {
    const { vault, importer } = await setup({
      "Export.zip": buildZip([
        { name: "Page.md", content: "# Page" },
        ...Array.from({ length: IMPORT_LIMITS.skippedListed + 2 }, (_, index) => ({
          name: `file-${index}.pdf`,
          content: "%PDF",
        })),
      ]),
    });
    const result = await picked(importer, join(vault, "Export.zip"), "notion");
    expect(result.skipped).toHaveLength(IMPORT_LIMITS.skippedListed + 1);
    expect(result.skipped.at(-1)).toEqual({ path: "2 more files", reason: "Not listed" });
  });
});
