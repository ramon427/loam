import { describe, expect, it } from "vitest";

import type { NoteFile, NoteGraph } from "@loam/shared/notes/noteModel";

import { upgradeTextTabs } from "../legacyTextTabs";

const markdownFile: NoteFile = { name: "plan.md", source: { kind: "imported", fileName: "a.md" } };

describe("former Text tabs", () => {
  it("open as a graph holding their Markdown as one text object", () => {
    const content = {
      tabs: [{ id: "t", kind: "markdown" }],
      textsByTab: { t: "# Plan\n\nWrite it down." },
      graphsByTab: {} as Record<string, NoteGraph>,
    };
    const upgraded = upgradeTextTabs(content);

    expect(upgraded.tabs).toEqual([{ id: "t", kind: "graph" }]);
    expect(upgraded.graphsByTab.t?.nodes).toEqual([
      expect.objectContaining({ shape: "text", notes: "# Plan\n\nWrite it down." }),
    ]);
    expect(upgraded.textsByTab).toBe(content.textsByTab);
  });

  it("keep a graph they already have, and leave other tabs alone", () => {
    const graph = { enabled: true, nodes: [], edges: [] };
    const content = { tabs: [{ id: "t", kind: "markdown" }], graphsByTab: { t: graph } };

    expect(upgradeTextTabs(content).graphsByTab.t).toBe(graph);
    const pages = { tabs: [{ id: "p", kind: "page" }], graphsByTab: {} };
    expect(upgradeTextTabs(pages)).toBe(pages);
  });

  it("are not Markdown file tabs, which have their file", () => {
    const content = { tabs: [{ id: "m", kind: "markdown" }], filesByTab: { m: markdownFile } };

    expect(upgradeTextTabs(content)).toBe(content);
  });

  it("are told apart by the note's files when a save doesn't name them", () => {
    const save = { tabs: [{ id: "m", kind: "markdown" }] };

    expect(upgradeTextTabs(save, { m: markdownFile })).toBe(save);
    expect(upgradeTextTabs(save).tabs).toEqual([{ id: "m", kind: "graph" }]);
  });
});
