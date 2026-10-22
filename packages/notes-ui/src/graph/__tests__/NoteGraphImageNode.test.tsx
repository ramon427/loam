// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NoteGraphPanel } from "../NoteGraphPanel";
import type { NoteDocument } from "../../workspace/types";
import type { NoteGraph } from "@loam/shared/notes/noteModel";

const note: NoteDocument = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Trip",
  updatedAt: "2026-10-01T00:00:00.000Z",
  tabs: [{ id: "graph-tab", title: "Map", kind: "graph" }],
  blocksByTab: { "graph-tab": [] },
  activeTabId: "graph-tab",
};

const graph: NoteGraph = {
  enabled: true,
  nodes: [
    {
      id: "beach",
      title: "Beach",
      position: { x: 0, y: 0 },
      shape: "image",
      imageUrl: "77aa.webp",
      size: { width: 240, height: 160 },
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
};

describe("graph image nodes", () => {
  it("show the stored image from the media folder", async () => {
    render(
      <NoteGraphPanel
        graph={graph}
        headingOptions={[]}
        note={note}
        onAddGraph={vi.fn()}
        onOpenHeading={vi.fn()}
        onSelectEdge={vi.fn()}
        onSelectNode={vi.fn()}
        onToggleHeadingConnection={vi.fn()}
        onUpdateGraph={vi.fn()}
        readOnly={false}
        selectedEdgeId={null}
        selectedNodeId={null}
        tabId="graph-tab"
      />,
    );

    const image = await screen.findByRole("img", { name: "Beach" });
    expect(image.getAttribute("src")).toBe("loam-media://images/77aa.webp");
  });
});
