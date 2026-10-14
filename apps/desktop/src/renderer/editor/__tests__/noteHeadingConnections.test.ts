import { describe, expect, it } from "vitest";

import type { NoteDocument } from "../../workspace/types";
import {
  captureNoteHeadingConnections,
  disconnectNoteHeadings,
  listNoteHeadingConnectionOptions,
  restoreNoteHeadingConnections,
  toggleNoteHeadingConnection,
} from "../noteHeadingConnections";

const createNote = (): NoteDocument => ({
  id: "note-1",
  title: "Playbook",
  updatedAt: "2026-07-19T00:00:00.000Z",
  activeTabId: "text-1",
  tabs: [
    { id: "text-1", title: "Plan", kind: "page" },
    { id: "graph-1", title: "Map", kind: "graph" },
    { id: "table-1", title: "Checklist", kind: "table" },
  ],
  blocksByTab: {
    "text-1": [
      {
        id: "heading-1",
        type: "heading",
        props: { level: 2, isToggleable: true },
        content: [{ type: "text", text: "Entry setup", styles: {} }],
        children: [
          {
            id: "heading-2",
            type: "heading",
            props: { level: 3 },
            content: [],
          },
        ],
      },
    ],
    "graph-1": [],
    "table-1": [],
  },
  graphsByTab: {
    "graph-1": {
      enabled: true,
      nodes: [
        {
          id: "node-1",
          title: "Breakout",
          position: { x: 0, y: 0 },
          headingBlockIds: ["heading-1", "heading-1"],
        },
      ],
      edges: [],
    },
  },
  tablesByTab: {
    "table-1": {
      columns: [
        {
          id: "column-1",
          title: "Rule",
          type: "text",
          headingBlockIds: ["heading-1"],
        },
      ],
      rows: [
        {
          id: "row-1",
          cells: { "column-1": "Wait for close" },
          headingBlockIds: ["heading-2"],
        },
      ],
    },
  },
});

describe("noteHeadingConnections", () => {
  it("discovers nested and toggle headings with connection counts", () => {
    expect(listNoteHeadingConnectionOptions(createNote())).toEqual([
      {
        headingBlockId: "heading-1",
        tabId: "text-1",
        tabTitle: "Plan",
        title: "Entry setup",
        level: 2,
        isToggleable: true,
        connectionCount: 2,
      },
      {
        headingBlockId: "heading-2",
        tabId: "text-1",
        tabTitle: "Plan",
        title: "Untitled heading",
        level: 3,
        isToggleable: false,
        connectionCount: 1,
      },
    ]);
  });

  it("toggles many-to-many connections and omits empty arrays", () => {
    const note = createNote();
    const removed = toggleNoteHeadingConnection(
      note,
      {
        kind: "table-row",
        tabId: "table-1",
        targetId: "row-1",
      },
      "heading-2",
    );
    expect(removed.tablesByTab["table-1"]?.rows[0]?.headingBlockIds).toBeUndefined();

    const added = toggleNoteHeadingConnection(
      { ...note, ...removed },
      {
        kind: "table-row",
        tabId: "table-1",
        targetId: "row-1",
      },
      "heading-1",
    );
    expect(added.tablesByTab["table-1"]?.rows[0]?.headingBlockIds).toEqual(["heading-1"]);
  });

  it("keeps removals available but refuses additions at the target limit", () => {
    const note = createNote();
    const cappedHeadingIds = Array.from({ length: 200 }, (_, index) => `heading-${index}`);
    const cappedNote: NoteDocument = {
      ...note,
      graphsByTab: {
        "graph-1": {
          ...note.graphsByTab!["graph-1"]!,
          nodes: [
            {
              ...note.graphsByTab!["graph-1"]!.nodes[0]!,
              headingBlockIds: cappedHeadingIds,
            },
          ],
        },
      },
    };

    const refused = toggleNoteHeadingConnection(
      cappedNote,
      {
        kind: "graph-node",
        tabId: "graph-1",
        targetId: "node-1",
      },
      "heading-over-limit",
    );
    expect(refused.graphsByTab["graph-1"]?.nodes[0]?.headingBlockIds).toEqual(cappedHeadingIds);

    const removed = toggleNoteHeadingConnection(
      cappedNote,
      {
        kind: "graph-node",
        tabId: "graph-1",
        targetId: "node-1",
      },
      "heading-0",
    );
    expect(removed.graphsByTab["graph-1"]?.nodes[0]?.headingBlockIds).not.toContain("heading-0");
  });

  it("captures, disconnects, and restores only targets that still exist", () => {
    const note = createNote();
    const snapshots = captureNoteHeadingConnections(note, ["heading-1"]);
    expect(snapshots).toHaveLength(2);

    const disconnected = disconnectNoteHeadings(note, ["heading-1"]);
    expect(disconnected.graphsByTab["graph-1"]?.nodes[0]?.headingBlockIds).toBeUndefined();
    expect(disconnected.tablesByTab["table-1"]?.columns[0]?.headingBlockIds).toBeUndefined();

    const restored = restoreNoteHeadingConnections(
      {
        ...note,
        ...disconnected,
        tablesByTab: {},
      },
      snapshots,
    );
    expect(restored.graphsByTab["graph-1"]?.nodes[0]?.headingBlockIds).toEqual(["heading-1"]);
    expect(restored.tablesByTab).toEqual({});
  });
});
