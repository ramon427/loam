// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NoteGraphPanel } from "../NoteGraphPanel";
import type { NoteDocument } from "../../workspace/types";
import type { NoteGraph } from "@loam/shared/notes/noteModel";
import { installReactFlowLayoutShims, nodeCard, renderNoteGraph } from "./renderNoteGraph";

installReactFlowLayoutShims();

const graph: NoteGraph = {
  enabled: true,
  nodes: [
    {
      id: "saved-process-node",
      title: "Draft plan",
      position: { x: 80, y: 80 },
      size: { width: 224, height: 84 },
      shape: "process",
      color: "blue",
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 0.85 },
};

describe("opening a graph tab", () => {
  it("shows a saved graph with its selected node, without update loops", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      renderNoteGraph(graph, { selectedNodeId: "saved-process-node" });

      expect(nodeCard("process node: Draft plan, blue, 224 by 84 pixels")).toBeTruthy();
      expect(screen.getByRole("toolbar", { name: "Selection actions" })).toBeTruthy();
      // Details wait until asked for.
      expect(screen.queryByRole("complementary", { name: "Node details" })).toBeNull();
      expect(consoleError.mock.calls.flat().join("\n")).not.toContain(
        "Maximum update depth exceeded",
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("offers to start a graph when the tab has none", () => {
    const note = {
      id: "note",
      title: "Empty",
      updatedAt: "2026-07-21T00:00:00.000Z",
      tabs: [{ id: "graph-tab", title: "Graph", kind: "graph" }],
      blocksByTab: { "graph-tab": [] },
      activeTabId: "graph-tab",
    } satisfies NoteDocument;
    render(
      <NoteGraphPanel
        headingOptions={[]}
        note={note}
        onAddGraph={() => undefined}
        onOpenHeading={() => undefined}
        onSelectEdge={() => undefined}
        onSelectNode={() => undefined}
        onToggleHeadingConnection={() => undefined}
        onUpdateGraph={() => undefined}
        readOnly
        selectedEdgeId={null}
        selectedNodeId={null}
        tabId="graph-tab"
      />,
    );

    expect(screen.getByText("Start a diagram")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add graph" })).toHaveProperty("disabled", true);
  });
});
