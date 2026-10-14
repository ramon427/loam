import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { NoteFile } from "@loam/shared/notes/noteModel";

import { createTempDirectories } from "@loam/storage/testing/tempDirectories";

import { createMediaStore } from "../mediaStore";
import { createTabFiles, openablePathsIn } from "../tabFiles";

const tempDirectory = createTempDirectories("loam-tab-files-");

const setUp = async ({
  deviceId = "this-computer",
  dataDirectory = tempDirectory(),
  linkedBefore = async () => [] as string[],
} = {}) => {
  const mediaDirectory = tempDirectory();
  const source = tempDirectory();
  const changes: string[] = [];
  const linkedPathsFile = join(dataDirectory, "linked-files.json");
  const files = await createTabFiles({
    media: createMediaStore(mediaDirectory),
    deviceId,
    linkedPathsFile,
    linkedBefore,
    onLinkedFileChange: (path) => changes.push(path),
  });
  const write = (name: string, content: string | Uint8Array) => {
    writeFileSync(join(source, name), content);
    return join(source, name);
  };
  return { files, mediaDirectory, dataDirectory, linkedPathsFile, write, changes };
};

/** A tab's file as a note may name it: a path on this computer it never linked. */
const named = (path: string, computerId = "this-computer"): NoteFile => ({
  name: basename(path),
  source: { kind: "referenced", path, computerId },
});

const PDF = "%PDF-1.7\n...";
const DOCX = "PK\u0003\u0004...word/document.xml...";

describe("tab files", () => {
  it("copies PDFs and Word documents in, and keeps Markdown as the note's text", async () => {
    const { files, mediaDirectory, write } = await setUp();

    const pdf = await files.importPath("pdf", write("Lecture 3.pdf", PDF));
    expect(pdf).toEqual({
      name: "Lecture 3.pdf",
      source: { kind: "imported", fileName: expect.stringMatching(/^[0-9a-f-]{36}\.pdf$/) },
    });
    await files.importPath("docx", write("Essay.docx", DOCX));
    const markdown = await files.importPath("markdown", write("plan.md", "# Plan\n\nRéviser."));
    expect(markdown).toEqual({
      name: "plan.md",
      source: { kind: "text", text: "# Plan\n\nRéviser." },
    });

    expect(readdirSync(mediaDirectory).map((name) => name.slice(37))).toEqual(
      expect.arrayContaining(["pdf", "docx"]),
    );
    expect(new TextDecoder().decode(await files.read("pdf", pdf))).toBe(PDF);
  });

  it("goes by a file's name and bytes, so it reads no other file", async () => {
    const { files, write } = await setUp();
    for (const [kind, path] of [
      ["pdf", write("plan.md", "# Plan")],
      ["pdf", write("fake.pdf", "# Not a PDF")],
      ["docx", write("Lecture.pdf", PDF)],
      ["markdown", write("binary.md", new Uint8Array([0x23, 0x00, 0xff]))],
      ["markdown", write("passwords", "secret")],
    ] as const)
      await expect(files.importPath(kind, path)).rejects.toMatchObject({ status: 415 });
    await expect(files.link("relative/plan.md")).rejects.toMatchObject({ status: 415 });
    await expect(files.link(write("notes.sqlite", "database"))).rejects.toMatchObject({
      status: 415,
    });
  });

  it("links a file where it is, on this computer only", async () => {
    const { files, write } = await setUp();
    const path = write("plan.md", "# Plan");

    const linked = await files.link(path);
    expect(linked).toEqual({
      kind: "markdown",
      file: { name: "plan.md", source: { kind: "referenced", path, computerId: "this-computer" } },
    });
    await files.writeMarkdown(linked.file, "# Plan, revised");
    expect(readFileSync(path, "utf8")).toBe("# Plan, revised");

    // A link to a file that isn't there doesn't make one.
    const gone = { ...linked.file, source: { ...linked.file.source, path: `${path}.gone.md` } };
    await expect(files.writeMarkdown(gone, "# New")).rejects.toMatchObject({ status: 403 });

    const elsewhere = (await setUp({ deviceId: "another-computer" })).files;
    await expect(elsewhere.read("markdown", linked.file)).rejects.toMatchObject({ status: 404 });
    // A linked file copied in is held by the note from then on.
    expect(await files.copyIn("markdown", linked.file)).toEqual({
      name: "plan.md",
      source: { kind: "text", text: "# Plan, revised" },
    });
  });

  it("reads, writes, copies, opens and watches only files this computer linked", async () => {
    const { files, write, dataDirectory, linkedPathsFile } = await setUp();
    const plantedPath = write("secrets.md", "# Secrets");
    const planted = named(plantedPath);

    await expect(files.read("markdown", planted)).rejects.toMatchObject({ status: 403 });
    await expect(files.writeMarkdown(planted, "# Gone")).rejects.toMatchObject({ status: 403 });
    await expect(files.copyIn("markdown", planted)).rejects.toMatchObject({ status: 403 });
    await expect(files.pathToOpen("markdown", planted)).rejects.toMatchObject({ status: 403 });
    expect(() => files.watch("markdown", plantedPath)).toThrow(
      expect.objectContaining({ status: 403 }),
    );
    expect(readFileSync(plantedPath, "utf8")).toBe("# Secrets");

    // A link made here is kept across launches, without naming the file.
    const path = write("plan.md", "# Plan");
    await files.link(path);
    expect(readFileSync(linkedPathsFile, "utf8")).not.toContain("plan.md");
    const reopened = (await setUp({ dataDirectory })).files;
    expect(new TextDecoder().decode(await reopened.read("markdown", named(path)))).toBe("# Plan");
    await expect(reopened.read("markdown", planted)).rejects.toMatchObject({ status: 403 });
  });

  it("starts the list from the links notes held before it was kept, once", async () => {
    const { write, dataDirectory } = await setUp();
    const path = write("plan.md", "# Plan");
    writeFileSync(join(dataDirectory, "linked-files.json"), "not json");
    // A list that can't be read trusts nothing.
    const unreadable = await setUp({ dataDirectory, linkedBefore: async () => [path] });
    await expect(unreadable.files.read("markdown", named(path))).rejects.toMatchObject({
      status: 403,
    });

    const fresh = tempDirectory();
    const first = await setUp({ dataDirectory: fresh, linkedBefore: async () => [path] });
    expect(new TextDecoder().decode(await first.files.read("markdown", named(path)))).toBe(
      "# Plan",
    );
    const linkedBefore = vi.fn(async () => [] as string[]);
    const later = await setUp({ dataDirectory: fresh, linkedBefore });
    expect(linkedBefore).not.toHaveBeenCalled();
    expect(new TextDecoder().decode(await later.files.read("markdown", named(path)))).toBe(
      "# Plan",
    );
  });

  it("opens a library file in another app as a copy, and takes the edited copy back", async () => {
    const { files, write } = await setUp();
    const pdf = await files.importPath("pdf", write("Lecture 3.pdf", PDF));

    const copy = await files.pathToOpen("pdf", pdf);
    expect(copy).toMatch(/Lecture 3\.pdf$/);
    writeFileSync(copy, `${PDF}\n% annotated`);
    const taken = await files.takeBackCopy("pdf", copy, "Lecture 3.pdf");
    expect(new TextDecoder().decode(await files.read("pdf", taken))).toContain("annotated");

    await expect(
      files.takeBackCopy("pdf", write("other.pdf", PDF), "other.pdf"),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("takes the files a launch names, as Open with passes them", () => {
    expect(
      openablePathsIn([
        ".",
        "--flag",
        "/home/me/Lecture 3.pdf",
        "notes.md",
        "C:\\Docs\\Essay.DOCX",
      ]),
    ).toEqual(process.platform === "win32" ? ["C:\\Docs\\Essay.DOCX"] : ["/home/me/Lecture 3.pdf"]);
  });

  it("tells when a watched file changes on disk", async () => {
    const { files, write, changes } = await setUp();
    const path = write("plan.md", "# Plan");
    await files.link(path);
    files.watch("markdown", path);
    await new Promise((resolve) => setTimeout(resolve, 50));
    writeFileSync(path, "# Plan, edited elsewhere");

    await expect.poll(() => changes).toEqual([path]);
    files.close();
  });
});
