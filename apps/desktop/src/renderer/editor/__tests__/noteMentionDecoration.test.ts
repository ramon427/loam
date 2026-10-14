// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { decorateNoteLinks } from "../noteMentionDecoration";

const render = (html: string) => {
  const root = document.createElement("div");
  root.innerHTML = html;
  return { root, anchors: Array.from(root.querySelectorAll("a")) };
};

describe("decorateNoteLinks", () => {
  it("marks video timestamps in both link forms, broken while the note has no video", () => {
    const { root, anchors } = render(`
      <a href="#note-video?t=83" title="old title">1:23</a>
      <a href="#note-ref?kind=video-timestamp&seconds=12">0:12</a>
      <a href="https://example.com">external</a>
    `);

    decorateNoteLinks(root, { hasVideo: true, readLinkCandidates: () => [] });
    const [current, older, external] = anchors;
    expect(current!.dataset.noteMention).toBe("video-timestamp");
    expect(current!.dataset.noteMentionBroken).toBe("false");
    expect(current!.hasAttribute("title")).toBe(false);
    expect(older!.dataset.noteMention).toBe("video-timestamp");
    expect(external!.dataset.noteMention).toBeUndefined();

    decorateNoteLinks(root, { hasVideo: false, readLinkCandidates: () => [] });
    expect(current!.dataset.noteMentionBroken).toBe("true");
  });

  it("marks the timestamps whose part of the video is playing", () => {
    const { root, anchors } = render(`
      <a href="#note-ref?kind=video-timestamp&seconds=12">0:12</a>
      <a href="#note-ref?kind=video-timestamp&seconds=83">1:23</a>
    `);

    decorateNoteLinks(root, {
      hasVideo: true,
      currentVideoTimestamp: 83,
      readLinkCandidates: () => [],
    });

    expect(anchors.map((anchor) => anchor.dataset.noteVideoCurrent)).toEqual(["false", "true"]);
  });

  const noteLinks = () =>
    render(`
      <a href="/notes?noteId=note-plan">Risk plan</a>
      <a href="/notes?noteId=note-deleted">Old plan</a>
      <a href="https://example.com/notes?noteId=note-plan">Elsewhere</a>
    `);

  it("marks links to existing and deleted notes", () => {
    const { root, anchors } = noteLinks();

    decorateNoteLinks(root, {
      hasVideo: false,
      readLinkCandidates: () => [{ id: "note-plan", title: "Risk plan" }],
    });

    const [existing, deleted, external] = anchors;
    expect(existing!.dataset.noteMention).toBe("note");
    expect(existing!.dataset.noteMentionBroken).toBe("false");
    expect(existing!.title).toBe("Open Risk plan");
    expect(deleted!.dataset.noteMentionBroken).toBe("true");
    expect(deleted!.title).toBe("This note no longer exists");
    expect(external!.dataset.noteMention).toBeUndefined();
  });

  it("does not call links broken before the library is known", () => {
    const { root, anchors } = noteLinks();

    decorateNoteLinks(root, { hasVideo: false, readLinkCandidates: () => [] });

    expect(anchors[1]!.dataset.noteMention).toBe("note");
    expect(anchors[1]!.dataset.noteMentionBroken).toBe("false");
  });
});
