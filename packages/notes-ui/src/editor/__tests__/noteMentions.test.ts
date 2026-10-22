import { describe, expect, it } from "vitest";

import { createNoteDocument } from "../../workspace/noteDocuments";
import { buildVideoTimestampHref } from "@loam/shared/notes/noteLinks";

import {
  buildNoteMentionMenuItems,
  currentVideoTimestamp,
  listNoteVideoTimestamps,
} from "../noteMentions";
import type { NoteDocument } from "../../workspace/types";

const tableTabId = "11111111-1111-4111-8111-111111111111";
const graphTabId = "22222222-2222-4222-8222-222222222222";

const createMentionNote = (): NoteDocument => {
  const note = createNoteDocument("Mentions");
  return {
    ...note,
    tabs: [
      ...note.tabs,
      { id: tableTabId, title: "Moves", kind: "table" },
      { id: graphTabId, title: "Flow", kind: "graph" },
    ],
    blocksByTab: {
      ...note.blocksByTab,
      [tableTabId]: [],
      [graphTabId]: [],
    },
    tablesByTab: {
      [tableTabId]: {
        columns: [
          {
            id: "column-technique",
            title: "Technique",
            type: "text",
            position: 0,
          },
        ],
        rows: [
          {
            id: "row-armbar",
            position: 0,
            cells: { "column-technique": "Armbar" },
          },
        ],
      },
    },
    graphsByTab: {
      [graphTabId]: {
        enabled: true,
        nodes: [
          {
            id: "node-grip",
            title: "Grip",
            position: { x: 10, y: 20 },
          },
        ],
        edges: [{ id: "edge-flow", source: "node-grip", target: "node-grip" }],
      },
    },
    video: {
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      videoId: "dQw4w9WgXcQ",
      title: "Armbar study",
      lastWatchedSeconds: 83,
    },
  };
};

const timestampLink = (href: string, label: string) => ({
  type: "link" as const,
  href,
  content: [{ type: "text" as const, text: label, styles: {} }],
});

describe("noteMentions", () => {
  it("offers the video's current moment", () => {
    const items = buildNoteMentionMenuItems(createMentionNote(), "arm");

    expect(items).toEqual([
      expect.objectContaining({
        section: "Video",
        title: "1:23",
        seconds: 83,
      }),
    ]);
  });

  it("offers other notes to link, matched by title and labeled by folder", () => {
    const note = createMentionNote();
    const candidates = [
      { id: note.id, title: "Mentions" },
      { id: "note-plan", title: "Risk plan", folderName: "Playbooks" },
      { id: "note-review", title: "Weekly review", folderName: null },
      { id: "note-untitled", title: "   " },
    ];

    expect(buildNoteMentionMenuItems(note, "plan", candidates)).toEqual([
      expect.objectContaining({
        id: "note:note-plan",
        title: "Risk plan",
        section: "Notes",
        noteId: "note-plan",
        detail: "Playbooks",
      }),
    ]);
    expect(buildNoteMentionMenuItems(note, "untitled", candidates)).toEqual([
      expect.objectContaining({ noteId: "note-untitled", title: "Untitled note", detail: "Note" }),
    ]);
    const unfiltered = buildNoteMentionMenuItems(note, "", candidates);
    expect(unfiltered.map((item) => item.noteId).filter(Boolean)).toEqual([
      "note-plan",
      "note-untitled",
      "note-review",
    ]);
    expect(unfiltered.some((item) => item.noteId === note.id)).toBe(false);
  });

  it("ranks title prefixes first and caps the note list", () => {
    const note = createMentionNote();
    const candidates = Array.from({ length: 12 }, (_, index) => ({
      id: `note-${index}`,
      title: index === 11 ? "Setup checklist" : `Old setup ${index}`,
    }));

    const items = buildNoteMentionMenuItems(note, "setup", candidates);

    expect(items).toHaveLength(8);
    expect(items[0]).toMatchObject({ noteId: "note-11", title: "Setup checklist" });
  });

  it("lists timestamps in both link forms from nested page tabs only", () => {
    const note = createMentionNote();
    const pageTab = note.tabs.find((tab) => (tab.kind ?? "page") === "page")!;
    const reviewTabId = "33333333-3333-4333-8333-333333333333";
    const noteWithTimestamps: NoteDocument = {
      ...note,
      tabs: [...note.tabs, { id: reviewTabId, title: "Review", kind: "page" }],
      blocksByTab: {
        ...note.blocksByTab,
        [pageTab.id]: [
          {
            type: "paragraph",
            content: [
              timestampLink("#note-ref?kind=video-timestamp&seconds=83", "1:23"),
              timestampLink(
                "https://example.com/#note-ref?kind=video-timestamp&seconds=9",
                "External canonical marker",
              ),
              timestampLink(
                "#note-ref?kind=video-timestamp&seconds=not-a-number",
                "Malformed canonical marker",
              ),
            ],
            children: [
              {
                type: "paragraph",
                content: [timestampLink("#note-video?t=12", "0:12")],
              },
            ],
          },
        ],
        [reviewTabId]: [
          {
            type: "paragraph",
            content: [
              timestampLink(buildVideoTimestampHref(83), "Duplicate"),
              timestampLink(buildVideoTimestampHref(3723), "1:02:03"),
              timestampLink("https://example.com/watch#note-video?t=21", "External legacy marker"),
              timestampLink("#note-video?t=invalid", "Malformed legacy marker"),
            ],
          },
        ],
        [graphTabId]: [
          {
            type: "paragraph",
            content: [timestampLink(buildVideoTimestampHref(1), "Graph tab")],
          },
        ],
      } as NoteDocument["blocksByTab"],
    };

    expect(listNoteVideoTimestamps(noteWithTimestamps).map(({ seconds }) => seconds)).toEqual([
      12, 83, 3723,
    ]);
  });

  it("names each timestamp after the text of the first block that links to it", () => {
    const note = createMentionNote();
    const pageTab = note.tabs.find((tab) => (tab.kind ?? "page") === "page")!;
    const timestamps = listNoteVideoTimestamps({
      ...note,
      blocksByTab: {
        ...note.blocksByTab,
        [pageTab.id]: [
          {
            type: "paragraph",
            content: [
              timestampLink(buildVideoTimestampHref(83), "1:23"),
              { type: "text" as const, text: " Gradient   descent ", styles: {} },
              { type: "link", href: "https://example.com", content: "diverges" },
            ],
          },
          {
            type: "paragraph",
            content: [
              timestampLink(buildVideoTimestampHref(83), "1:23"),
              { type: "text" as const, text: " Again", styles: {} },
            ],
          },
        ],
      } as NoteDocument["blocksByTab"],
    });

    expect(timestamps).toEqual([{ seconds: 83, text: "Gradient descent diverges" }]);
  });

  it("finds the timestamp whose part of the video is playing", () => {
    const timestamps = [
      { seconds: 10, text: "Intro" },
      { seconds: 60, text: "Main" },
    ];

    expect(currentVideoTimestamp(timestamps, 5)).toBeNull();
    expect(currentVideoTimestamp(timestamps, 10)?.text).toBe("Intro");
    expect(currentVideoTimestamp(timestamps, 75)?.text).toBe("Main");
  });
});
