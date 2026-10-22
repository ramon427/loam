// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { buildNoteHref } from "@loam/shared/notes/noteLinks";

import { withRenamedSubNoteLinks, withSubNoteLink } from "../subNoteLinks";
import type { NoteDocument } from "../types";

const SUB = "00000000-0000-4000-8000-000000000002";

const parent = (blocks: unknown[]): NoteDocument => ({
  id: "00000000-0000-4000-8000-000000000001",
  title: "Parent",
  updatedAt: "2026-10-14T00:00:00.000Z",
  tabs: [
    { id: "board", title: "Board", kind: "board" },
    { id: "page", title: "Notes", kind: "page" },
  ],
  blocksByTab: { board: [], page: blocks as NoteDocument["blocksByTab"][string] },
  activeTabId: "board",
});

const linkTo = (label: string) => ({
  type: "link",
  href: buildNoteHref(SUB),
  content: [{ type: "text", text: label, styles: {} }],
});

/** Each link's text in the page tab. */
const linkTexts = (blocksByTab: NoteDocument["blocksByTab"] | null) =>
  JSON.stringify(blocksByTab?.page ?? []).match(/"text":"[^"]*"/g);

describe("links to sub-notes", () => {
  it("links a new sub-note from the parent's page, above its last empty line", () => {
    const blocks = withSubNoteLink(
      parent([
        { id: "a", type: "paragraph", content: [{ type: "text", text: "Intro", styles: {} }] },
        { id: "b", type: "paragraph", content: [] },
      ]),
      { id: SUB, title: "" },
    );
    expect(blocks?.page?.map((block) => block.id)).toEqual(["a", expect.any(String), "b"]);
    expect(blocks?.page?.[1]).toMatchObject({ content: [linkTo("Untitled note")] });
    expect(
      withSubNoteLink({ ...parent([]), tabs: [parent([]).tabs[0]!] }, { id: SUB, title: "" }),
    ).toBeNull();
  });

  it("retitles links that still show the old title, nested ones too", () => {
    const blocks = [
      { id: "a", type: "paragraph", content: [linkTo("Untitled note")] },
      {
        id: "b",
        type: "bulletListItem",
        content: [linkTo("Named by me")],
        children: [{ id: "c", type: "paragraph", content: [linkTo("Untitled note")] }],
      },
    ];
    const renamed = withRenamedSubNoteLinks(parent(blocks), SUB, "", "Plan");
    expect(linkTexts(renamed)).toEqual(['"text":"Plan"', '"text":"Named by me"', '"text":"Plan"']);
    expect(withRenamedSubNoteLinks(parent(blocks), SUB, "Other", "Plan")).toBeNull();
  });
});
