import { describe, expect, it } from "vitest";

import { flattenLegacyNoteLinks } from "../legacyNoteLinks";

const text = (value: string) => ({ type: "text", text: value, styles: {} });
const link = (href: string, content: unknown) => ({ type: "link", href, content });
const paragraph = (...content: unknown[]) => ({
  id: "p",
  type: "paragraph",
  content,
  children: [],
});

describe("flattenLegacyNoteLinks", () => {
  it("turns links to graphs and tables into their text", () => {
    const blocks = [
      paragraph(
        text("See "),
        link("#note-ref?kind=graph-node&tab=g&target=n", [text("the node")]),
        text(", "),
        link("#note-graph?node=n", "the graph"),
      ),
    ];
    expect(flattenLegacyNoteLinks(blocks)).toEqual([
      paragraph(text("See "), text("the node"), text(", "), text("the graph")),
    ]);
  });

  it("keeps links that still open: notes, video moments and the web", () => {
    const blocks = [
      paragraph(
        link("/notes?noteId=abc", [text("a note")]),
        link("#note-ref?kind=video-timestamp&seconds=12", [text("0:12")]),
        link("https://example.com/#note-graph-ideas", [text("a site")]),
      ),
    ];
    expect(flattenLegacyNoteLinks(blocks)).toEqual(blocks);
  });

  it("reaches links in nested blocks", () => {
    const nested = [
      { ...paragraph(), children: [paragraph(link("#note-ref?kind=table", [text("t")]))] },
    ];
    expect(flattenLegacyNoteLinks(nested)).toEqual([
      { ...paragraph(), children: [paragraph(text("t"))] },
    ]);
  });
});
