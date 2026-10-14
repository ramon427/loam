import { describe, expect, it } from "vitest";

import { parseNoteGraphMermaid } from "../../markdown/parseNoteGraphMermaid";
import type { NoteDocument, NoteGraph } from "@loam/shared/notes/noteModel";

import { buildNoteGraphMermaid } from "../../markdown/noteGraphMermaid";
import { buildNoteTableMarkdown } from "../../markdown/noteTableMarkdown";
import { buildMarkdownExport, type MarkdownExportFile } from "../buildMarkdownExport";
import { createUniqueNamer, toSafeFileName } from "../exportFileNames";

const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const IMAGE = "11111111-1111-4111-8111-111111111111.png";

const text = (value: string) => ({ type: "text", text: value, styles: {} });
const paragraph = (...content: unknown[]) => ({
  id: crypto.randomUUID(),
  type: "paragraph",
  props: {},
  content,
  children: [],
});
const noteLink = (noteId: string, label: string) => ({
  type: "link",
  href: `/notes?noteId=${noteId}`,
  content: [text(label)],
});

const note = (index: number, overrides: Partial<NoteDocument> = {}): NoteDocument => ({
  contentState: "full",
  id: id(index),
  title: `Note ${index}`,
  updatedAt: "2026-10-10T09:00:00.000Z",
  tabs: [{ id: "tab-1", title: "Notes", kind: "page", position: 0 }],
  blocksByTab: { "tab-1": [paragraph(text(`Body ${index}`))] },
  activeTabId: "tab-1",
  ...overrides,
});

const graph: NoteGraph = {
  enabled: true,
  nodes: [
    { id: "a", title: "Idea [draft]", shape: "process", position: { x: 0, y: 0 } },
    { id: "b", title: 'Decide "now"?', shape: "decision", position: { x: 200, y: 0 } },
    { id: "c", title: "Done", shape: "terminator", position: { x: 400, y: 0 } },
    { id: "f", title: "Group", shape: "frame", position: { x: -50, y: -50 } },
    { id: "i", title: "Picture", shape: "image", imageUrl: IMAGE, position: { x: 0, y: 200 } },
  ],
  edges: [
    { id: "e1", source: "a", target: "b", label: "then | maybe" },
    { id: "e2", source: "b", target: "c", direction: "none", dashed: true },
    { id: "e3", source: "c", target: "a", direction: "both" },
    { id: "e4", source: "a", target: "c", direction: "start" },
  ],
};

const fileByPath = (files: MarkdownExportFile[], path: string) => {
  const file = files.find((candidate) => candidate.path === path);
  if (!file) throw new Error(`Missing ${path} in ${files.map((f) => f.path).join(", ")}`);
  return file;
};
const textOf = (files: MarkdownExportFile[], path: string) => {
  const file = fileByPath(files, path);
  if (file.kind !== "text") throw new Error(`${path} is not text`);
  return file.content;
};

describe("file names", () => {
  it("are valid everywhere and never empty", () => {
    expect(toSafeFileName('a/b\\c:d*e?f"g<h>i|j#k^l[m]n')).toBe("a-b-c-d-e-f-g-h-i-j-k-l-m-n");
    expect(toSafeFileName("  ..hidden. ")).toBe("hidden");
    expect(toSafeFileName("")).toBe("Untitled");
    expect(toSafeFileName("CON")).toBe("CON_");
    expect(toSafeFileName("😀".repeat(150))).toBe("😀".repeat(100));
    expect(toSafeFileName(`${"a".repeat(99)}. more`)).toBe("a".repeat(99));
  });

  it("are unique per folder regardless of case", () => {
    const next = createUniqueNamer();
    expect([next("Plan", ".md"), next("plan", ".md"), next("Plan", ".canvas")]).toEqual([
      "Plan",
      "plan (2)",
      "Plan",
    ]);
  });
});

describe("buildNoteGraphMermaid", () => {
  it("writes a flowchart the app's Mermaid import reads back", () => {
    const mermaid = buildNoteGraphMermaid(graph);
    expect(mermaid).toContain("%% frame: Group");
    expect(mermaid).toContain('n0["Idea #91;draft#93;"]');
    expect(mermaid).toContain('n1{"Decide #quot;now#quot;?"}');
    expect(mermaid).toContain('n2("Done")');

    const parsed = parseNoteGraphMermaid(mermaid);
    const titleOf = (nodeId: string) => parsed.nodes.find((node) => node.id === nodeId)?.title;
    expect(parsed.nodes.map((node) => node.title)).toEqual([
      "Idea [draft]",
      'Decide "now"?',
      "Done",
      "Picture",
    ]);
    expect(
      parsed.edges.map((edge) => [
        titleOf(edge.source),
        titleOf(edge.target),
        edge.label,
        edge.direction ?? "end",
      ]),
    ).toEqual([
      ["Idea [draft]", 'Decide "now"?', "then | maybe", "end"],
      ['Decide "now"?', "Done", undefined, "none"],
      ["Done", "Idea [draft]", undefined, "both"],
      ["Done", "Idea [draft]", undefined, "end"],
    ]);
  });
});

describe("buildNoteTableMarkdown", () => {
  it("orders columns and rows and formats each column type", () => {
    expect(
      buildNoteTableMarkdown({
        columns: [
          { id: "done", title: "Done", type: "boolean", position: 2 },
          { id: "name", title: "Name | full", type: "text", position: 0 },
          {
            id: "status",
            title: "Status",
            type: "select",
            position: 1,
            options: [{ id: "s1", label: "Active" }],
          },
        ],
        rows: [
          { id: "r2", position: 1, cells: { name: "Second", done: false } },
          { id: "r1", position: 0, cells: { name: "First\nline", status: "s1", done: true } },
        ],
      }),
    ).toBe(
      [
        "| Name \\| full | Status | Done |",
        "| --- | --- | --- |",
        "| First<br>line | Active | Yes |",
        "| Second |   | No |",
      ].join("\n"),
    );
  });
});

describe("buildMarkdownExport", () => {
  it("lays notes out by folder with front matter and wikilinks", () => {
    const plan = buildMarkdownExport({
      folders: [
        { id: "f1", name: "Projects", position: 0 },
        { id: "f2", name: "attachments", position: 1 },
      ],
      notes: [
        note(1, {
          title: "Plan: Q4",
          folderId: "f1",
          blocksByTab: { "tab-1": [paragraph(text("See "), noteLink(id(2), "the ideas"))] },
        }),
        note(2, { title: "Ideas" }),
        note(3, { title: "Stray", folderId: "deleted-folder" }),
        note(4, { title: "Archive", folderId: "f2" }),
      ],
    });

    expect(plan.noteCount).toBe(4);
    expect(plan.files.map((file) => file.path).sort()).toEqual([
      "Ideas.md",
      "Projects/Plan- Q4.md",
      "Stray.md",
      "attachments (2)/Archive.md",
    ]);
    expect(textOf(plan.files, "Projects/Plan- Q4.md")).toBe(
      [
        "---",
        'title: "Plan: Q4"',
        `loam-id: "${id(1)}"`,
        'updated: "2026-10-10T09:00:00.000Z"',
        "---",
        "",
        "See [[Ideas|the ideas]]",
        "",
      ].join("\n"),
    );
  });

  it("puts each project in its own directory with its folders and notes", () => {
    const image = { id: "img", type: "image", props: { url: IMAGE }, content: [], children: [] };
    const plan = buildMarkdownExport({
      projects: [
        { id: "p1", name: "Work: 2026", position: 0, icon: { kind: "emoji", value: "💼" } },
        { id: "p2", name: "attachments", position: 1 },
      ],
      folders: [
        { id: "f1", name: "Plans", position: 0, projectId: "p1" },
        // Names are unique per directory, so a name can be used inside and outside a project.
        { id: "f2", name: "Plans", position: 1 },
      ],
      notes: [
        note(1, { title: "Roadmap", folderId: "f1", blocksByTab: { "tab-1": [image] } }),
        note(2, { title: "Plans", projectId: "p1" }),
        note(3, { title: "Loose", folderId: "f2" }),
        note(4, { title: "Stray", projectId: "deleted-project" }),
        note(5, { title: "Home", projectId: "p2" }),
      ],
    });
    expect(plan.files.map((file) => file.path).sort()).toEqual([
      "Plans/Loose.md",
      "Stray.md",
      "Work- 2026/Plans.md",
      "Work- 2026/Plans/Roadmap.md",
      "attachments (2)/Home.md",
      `attachments/${IMAGE}`,
    ]);
    expect(textOf(plan.files, "Work- 2026/Plans/Roadmap.md")).toContain(
      `![image](../../attachments/${IMAGE})`,
    );
  });

  it("uses folder paths in links only when two notes share a name", () => {
    const plan = buildMarkdownExport({
      folders: [{ id: "f1", name: "Work", position: 0 }],
      notes: [
        note(1, { title: "Ideas", folderId: "f1" }),
        note(2, { title: "Ideas" }),
        note(3, {
          title: "Index",
          blocksByTab: {
            "tab-1": [paragraph(noteLink(id(1), "Ideas"), text(" "), noteLink(id(2), "Ideas"))],
          },
        }),
      ],
    });
    expect(textOf(plan.files, "Index.md")).toContain("[[Work/Ideas]] [[Ideas]]");
  });

  it("copies images once into attachments with paths relative to each note", () => {
    const image = { id: "img", type: "image", props: { url: IMAGE }, content: [], children: [] };
    const remote = {
      ...image,
      id: "remote",
      props: { url: `loam-media://images/${IMAGE}`, caption: "Same file" },
    };
    const plan = buildMarkdownExport({
      folders: [{ id: "f1", name: "Folder", position: 0 }],
      notes: [
        note(1, { blocksByTab: { "tab-1": [image] } }),
        note(2, { folderId: "f1", blocksByTab: { "tab-1": [remote] } }),
      ],
    });
    expect(textOf(plan.files, "Note 1.md")).toContain(`![image](attachments/${IMAGE})`);
    expect(textOf(plan.files, "Folder/Note 2.md")).toContain(
      `![Same file](../attachments/${IMAGE})`,
    );
    expect(plan.files.filter((file) => file.kind === "media")).toEqual([
      { kind: "media", path: `attachments/${IMAGE}`, mediaFile: IMAGE },
    ]);
  });

  it("gives each tab a section, diagrams a .canvas file and tables a Markdown table", () => {
    const plan = buildMarkdownExport({
      folders: [],
      notes: [
        note(1, {
          title: "Study",
          video: {
            url: "https://www.youtube.com/watch?v=abc123",
            videoId: "abc123",
            title: "Talk",
          },
          tabs: [
            { id: "t1", title: "Notes", kind: "page", position: 0 },
            { id: "g1", title: "Flow", kind: "graph", position: 1 },
            { id: "x1", title: "Data", kind: "table", position: 2 },
            { id: "e1", title: "Site", kind: "embed", position: 3 },
            { id: "e2", title: "Photo", kind: "embed", position: 4 },
          ],
          blocksByTab: {
            t1: [
              paragraph({
                type: "link",
                href: "#note-ref?kind=video-timestamp&seconds=90",
                content: [text("1:30")],
              }),
            ],
          },
          graphsByTab: { g1: graph },
          tablesByTab: {
            x1: { columns: [{ id: "c", title: "Col", type: "text" }], rows: [] },
          },
          embedsByTab: { e1: { url: "https://example.com/docs" }, e2: { url: IMAGE } },
        }),
      ],
    });

    const markdown = textOf(plan.files, "Study.md");
    expect(markdown).toContain('video: "https://www.youtube.com/watch?v=abc123"');
    expect(markdown).toContain("Video: [Talk](https://www.youtube.com/watch?v=abc123)");
    expect(markdown).toContain("# Notes\n\n[1:30](https://www.youtube.com/watch?v=abc123&t=90s)");
    expect(markdown).toContain("# Flow\n\n```mermaid\nflowchart TD");
    expect(markdown).toContain("Full diagram: [[Study - Flow.canvas]]");
    expect(markdown).toContain("# Data\n\n| Col |\n| --- |");
    expect(markdown).toContain("# Site\n\n[https://example.com/docs](https://example.com/docs)");
    expect(markdown).toContain(`# Photo\n\n![](attachments/${IMAGE})`);

    const canvas = JSON.parse(textOf(plan.files, "Study - Flow.canvas")) as {
      nodes: Array<{ id: string; type: string; file?: string }>;
      edges: unknown[];
    };
    expect(canvas.nodes).toHaveLength(5);
    expect(canvas.nodes.find((node) => node.id === "i")).toMatchObject({
      type: "file",
      file: `attachments/${IMAGE}`,
    });
    expect(canvas.edges).toHaveLength(4);
    expect(plan.files.some((file) => file.kind === "media" && file.mediaFile === IMAGE)).toBe(true);
  });

  it("exports a diagram stored the old way, on the note itself", () => {
    const plan = buildMarkdownExport({ folders: [], notes: [note(1, { graph })] });
    expect(textOf(plan.files, "Note 1.md")).toContain("# Diagram\n\n```mermaid");
    expect(fileByPath(plan.files, "Note 1 - Diagram.canvas").kind).toBe("text");
  });

  it("keeps links to notes outside a single-note export", () => {
    const plan = buildMarkdownExport({
      folders: [],
      notes: [
        note(1, {
          blocksByTab: {
            "tab-1": [paragraph(noteLink(id(2), "x")), paragraph(noteLink(id(3), "y"))],
          },
        }),
      ],
      linkableNotes: [{ id: id(2), title: "Other: note" }],
    });
    expect(textOf(plan.files, "Note 1.md")).toContain("[[Other- note|x]]\n\ny");
  });

  it("skips a video link that is not https", () => {
    const plan = buildMarkdownExport({
      folders: [],
      notes: [note(1, { video: { url: "javascript:alert(1)", videoId: "x" } })],
    });
    expect(textOf(plan.files, "Note 1.md")).not.toContain("javascript");
  });
});
