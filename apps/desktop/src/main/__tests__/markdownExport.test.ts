import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createNote,
  createTestStore,
  folderId,
  noteId,
  noteLink,
  paragraph,
  projectId,
} from "@loam/storage/testing/storeFixtures";
import { createTempDirectories } from "@loam/storage/testing/tempDirectories";

import { exportNotesAsMarkdown, writeMarkdownExport } from "../markdownExport";

const IMAGE = "11111111-1111-4111-8111-111111111111.png";
const NOW = new Date(2026, 9, 10, 14, 30);

const tempDirectory = createTempDirectories("loam-export-");

const listFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(directory.length + 1))
    .sort();

describe("writeMarkdownExport", () => {
  it("writes text and copies images into a new dated folder", async () => {
    const parent = tempDirectory();
    const media = tempDirectory();
    writeFileSync(join(media, IMAGE), "png-bytes");

    const result = await writeMarkdownExport({
      parentDirectory: parent,
      mediaDirectory: media,
      now: NOW,
      plan: {
        noteCount: 1,
        files: [
          { kind: "text", path: "Folder/Note.md", content: "# Hi\n" },
          { kind: "media", path: `attachments/${IMAGE}`, mediaFile: IMAGE },
          {
            kind: "media",
            path: "attachments/22222222-2222-4222-8222-222222222222.png",
            mediaFile: "22222222-2222-4222-8222-222222222222.png",
          },
          { kind: "media", path: "attachments/evil.png", mediaFile: "../notes.sqlite" },
        ],
      },
    });

    expect(result).toEqual({
      directory: join(parent, "Loam export 2026-10-10 1430"),
      noteCount: 1,
      fileCount: 2,
      missingImages: 2,
    });
    expect(listFiles(result.directory)).toEqual(["Folder/Note.md", `attachments/${IMAGE}`]);
    expect(readFileSync(join(result.directory, "Folder/Note.md"), "utf8")).toBe("# Hi\n");
    expect(readFileSync(join(result.directory, `attachments/${IMAGE}`), "utf8")).toBe("png-bytes");
  });

  it("never reuses an existing folder", async () => {
    const parent = tempDirectory();
    const plan = { noteCount: 0, files: [{ kind: "text" as const, path: "a.md", content: "a" }] };
    const first = await writeMarkdownExport({
      plan,
      parentDirectory: parent,
      mediaDirectory: parent,
      now: NOW,
    });
    const second = await writeMarkdownExport({
      plan,
      parentDirectory: parent,
      mediaDirectory: parent,
      now: NOW,
    });
    expect(second.directory).toBe(`${first.directory} (2)`);
  });

  it("refuses paths that leave the export folder", async () => {
    const parent = tempDirectory();
    await expect(
      writeMarkdownExport({
        parentDirectory: parent,
        mediaDirectory: parent,
        now: NOW,
        plan: { noteCount: 0, files: [{ kind: "text", path: "../escape.md", content: "x" }] },
      }),
    ).rejects.toThrow(/outside the export folder/);
    expect(readdirSync(parent)).toEqual(["Loam export 2026-10-10 1430"]);
  });
});

describe("exportNotesAsMarkdown", () => {
  it("exports each project as a directory of its folders and notes", async () => {
    const store = await createTestStore();
    await store.saveLayout({
      projects: [{ id: projectId(1), name: "Work" }],
      folders: [{ id: folderId(1), name: "Plans", projectId: projectId(1) }],
      notes: [],
    });
    await createNote(store, noteId(1), { title: "Roadmap", folderId: folderId(1) });
    await createNote(store, noteId(2), { title: "Ideas", projectId: projectId(1) });
    await createNote(store, noteId(3), { title: "Inbox" });
    const parent = tempDirectory();

    const result = await exportNotesAsMarkdown({
      store,
      scope: { kind: "all" },
      parentDirectory: parent,
      mediaDirectory: parent,
    });

    expect(listFiles(result.directory)).toEqual([
      "Inbox.md",
      "Work/Ideas.md",
      "Work/Plans/Roadmap.md",
    ]);
  });

  it("exports every saved note or just one, keeping links to the rest of the library", async () => {
    const store = await createTestStore();
    await createNote(store, noteId(1), {
      title: "Index",
      blocks: [paragraph(noteLink(noteId(2), "see ideas"))],
    });
    await createNote(store, noteId(2), { title: "Ideas" });
    // A deleted note is neither exported nor linked.
    await createNote(store, noteId(3), { title: "Gone" });
    await store.deleteNote(noteId(3));
    const parent = tempDirectory();
    const exportScope = (scope: Parameters<typeof exportNotesAsMarkdown>[0]["scope"]) =>
      exportNotesAsMarkdown({ store, scope, parentDirectory: parent, mediaDirectory: parent });

    const all = await exportScope({ kind: "all" });
    expect(all.noteCount).toBe(2);
    expect(listFiles(all.directory)).toEqual(["Ideas.md", "Index.md"]);
    expect(readFileSync(join(all.directory, "Index.md"), "utf8")).toContain("[[Ideas|see ideas]]");

    const one = await exportScope({ kind: "note", noteId: noteId(1) });
    expect(listFiles(one.directory)).toEqual(["Index.md"]);
    expect(readFileSync(join(one.directory, "Index.md"), "utf8")).toContain("[[Ideas|see ideas]]");
  });
});
