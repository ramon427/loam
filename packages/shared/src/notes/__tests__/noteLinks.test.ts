import { describe, expect, it } from "vitest";

import {
  buildNoteHref,
  buildVideoTimestampHref,
  readNoteHrefNoteId,
  readVideoTimestampHref,
} from "../noteLinks";

describe("note links", () => {
  const origin = "loam-app://notes";

  it("round-trips a note id through the stored link format", () => {
    expect(buildNoteHref("note/with spaces")).toBe("/notes?noteId=note%2Fwith%20spaces");
    expect(readNoteHrefNoteId(buildNoteHref("note/with spaces"))).toBe("note/with spaces");
  });

  it("reads only links to the app's notes", () => {
    expect(readNoteHrefNoteId("/notes?noteId=note-1")).toBe("note-1");
    expect(readNoteHrefNoteId("/notes?noteId=note-1&tab=t#top")).toBe("note-1");
    expect(readNoteHrefNoteId(`${origin}/notes?noteId=note-1`, origin)).toBe("note-1");
    for (const href of [
      "https://example.com/notes?noteId=note-1",
      `${origin}/notes?noteId=note-1`,
      "/notes",
      "/notes?noteId=",
      "/notes?noteId=%E0%A4%A",
      "/notes?noteId=%00",
      "/settings?noteId=note-1",
      "#note-video?t=3",
      null,
    ]) {
      expect(readNoteHrefNoteId(href)).toBeNull();
    }
  });
});

describe("video timestamp links", () => {
  it("round-trips a moment through the stored link format", () => {
    expect(buildVideoTimestampHref(83.7)).toBe("#note-video?t=83");
    expect(readVideoTimestampHref(buildVideoTimestampHref(83))).toBe(83);
  });

  it("reads the older editor form and spelled-out times", () => {
    expect(readVideoTimestampHref("#note-ref?kind=video-timestamp&seconds=90")).toBe(90);
    expect(readVideoTimestampHref("#note-video?t=1m30s")).toBe(90);
  });

  it("reads nothing from other links", () => {
    for (const href of [
      "#note-ref?kind=graph-node&target=n",
      "#note-ref?kind=video-timestamp",
      "#note-video",
      "/notes?noteId=n",
      "https://example.com/#note-video?t=3",
    ]) {
      expect(readVideoTimestampHref(href)).toBeNull();
    }
  });
});
