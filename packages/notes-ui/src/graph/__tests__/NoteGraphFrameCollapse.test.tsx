// @vitest-environment jsdom

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { noteGraphFrameCollapsedHeight } from "../noteGraphFrames";

import { installReactFlowLayoutShims, pressCanvasKey, renderNoteGraph } from "./renderNoteGraph";
import type { NoteGraph, NoteGraphNode } from "@loam/shared/notes/noteModel";

installReactFlowLayoutShims();

const frameNode = (id: string, title: string, x: number, y: number): NoteGraphNode => ({
  id,
  title,
  position: { x, y },
  shape: "frame",
  size: { width: 480, height: 320 },
});

const processNode = (id: string, title: string, x: number, y: number): NoteGraphNode => ({
  id,
  title,
  position: { x, y },
  shape: "process",
  size: { width: 120, height: 60 },
});

// Member centers sit deep inside the expanded frame rect and far below the 44px
// title bar a collapsed frame renders, which is where membership used to break.
const baseGraph: NoteGraph = {
  enabled: true,
  nodes: [
    frameNode("frame-a", "Group A", 0, 0),
    processNode("member-a", "Inside A", 40, 240),
    frameNode("frame-b", "Group B", 800, 0),
    processNode("member-b", "Inside B", 840, 240),
    processNode("outside", "Outside", 1600, 0),
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 0.85 },
};

const findNode = (graph: NoteGraph, id: string) => graph.nodes.find((node) => node.id === id);

function renderGraphPanel(options: { initialSelectedNodeId?: string | null } = {}) {
  const view = renderNoteGraph(baseGraph, { selectedNodeId: options.initialSelectedNodeId });
  return { savedGraph: view.savedGraph, selectNode: view.onSelectNode };
}

const expandedFrameCard = (title: string) => new RegExp(`^Frame: ${title}, 480 by 320 pixels$`);
const collapsedFrameCard = (title: string) =>
  new RegExp(`^Frame: ${title}, [0-9]+ by 44 pixels, collapsed$`);

const collapseFrame = async (title: string) => {
  const card = screen.getByRole("group", { name: expandedFrameCard(title) });
  fireEvent.click(within(card).getByRole("button", { name: "Collapse frame" }));
  await waitFor(() => {
    expect(screen.getByRole("group", { name: collapsedFrameCard(title) })).toBeTruthy();
  });
};

describe("note graph frame collapse", () => {
  it("keeps collapsed frame members hidden after the graph sync", async () => {
    const { savedGraph } = renderGraphPanel();

    await collapseFrame("Group A");

    // Hiding and the member count both measure the expanded rect, so shrinking
    // the frame to a title bar cannot drop its members.
    expect(screen.getByText("1 hidden")).toBeTruthy();
    expect(screen.queryByRole("group", { name: /Inside A/ })).toBeNull();
    const collapsedFrame = findNode(savedGraph(), "frame-a");
    expect(collapsedFrame?.collapsed).toBe(true);
    expect(collapsedFrame?.expandedSize).toEqual({ width: 480, height: 320 });
    expect(collapsedFrame?.size?.height).toBe(noteGraphFrameCollapsedHeight);
  });

  it("keeps a collapsed frame's members hidden while another frame collapses", async () => {
    renderGraphPanel();

    await collapseFrame("Group A");
    await collapseFrame("Group B");

    expect(screen.queryByRole("group", { name: /Inside A/ })).toBeNull();
    expect(screen.queryByRole("group", { name: /Inside B/ })).toBeNull();
    expect(screen.getByRole("group", { name: collapsedFrameCard("Group A") })).toBeTruthy();
    expect(screen.getByRole("group", { name: collapsedFrameCard("Group B") })).toBeTruthy();
  });

  it("keeps select-all and nudge off hidden members", async () => {
    const { savedGraph } = renderGraphPanel();

    await collapseFrame("Group A");
    pressCanvasKey("a", { ctrlKey: true });
    pressCanvasKey("ArrowRight");

    await waitFor(
      () => {
        const last = savedGraph();
        expect(last ? findNode(last, "frame-a")?.position.x : 0).toBe(1);
      },
      { timeout: 3000 },
    );
    const last = savedGraph();
    expect(findNode(last, "member-a")?.position.x).toBe(40);
    expect(findNode(last, "outside")?.position.x).toBe(1601);
  });

  it("drops a hidden member from the selection and spares it from delete", async () => {
    const { savedGraph, selectNode } = renderGraphPanel({ initialSelectedNodeId: "member-a" });

    await collapseFrame("Group A");

    // The member is no longer drawn, so it cannot stay the primary selection.
    await waitFor(() => expect(selectNode).toHaveBeenCalledWith(null));

    pressCanvasKey("a", { ctrlKey: true });
    pressCanvasKey("Delete");

    await waitFor(
      () => {
        const last = savedGraph();
        expect(last ? findNode(last, "outside") : { id: "outside" }).toBeUndefined();
      },
      { timeout: 3000 },
    );
    expect(savedGraph().nodes.map((node) => node.id)).toEqual(["member-a"]);
  });

  it("ignores resize keys while a frame is collapsed", async () => {
    const { savedGraph } = renderGraphPanel({ initialSelectedNodeId: "frame-a" });

    await collapseFrame("Group A");
    const collapsedLabel = () =>
      screen.getByRole("group", { name: collapsedFrameCard("Group A") }).getAttribute("aria-label");
    const labelBeforeResize = collapsedLabel();

    pressCanvasKey("ArrowRight", { ctrlKey: true });

    // The title bar is not a resize target, so neither the collapsed geometry
    // nor the size the frame restores may change.
    expect(collapsedLabel()).toBe(labelBeforeResize);
    expect(findNode(savedGraph(), "frame-a")?.expandedSize).toEqual({
      width: 480,
      height: 320,
    });

    const collapsedCard = screen.getByRole("group", { name: collapsedFrameCard("Group A") });
    fireEvent.click(within(collapsedCard).getByRole("button", { name: "Expand frame" }));
    await waitFor(
      () => {
        const expanded = findNode(savedGraph(), "frame-a");
        expect(expanded?.collapsed).toBeUndefined();
        expect(expanded?.size).toEqual({ width: 480, height: 320 });
      },
      { timeout: 3000 },
    );

    // Expanded frames keep resizing from the keyboard.
    pressCanvasKey("ArrowRight", { ctrlKey: true });
    await waitFor(
      () => {
        expect(findNode(savedGraph(), "frame-a")?.size).toEqual({ width: 496, height: 320 });
      },
      { timeout: 3000 },
    );
  });

  it("keeps the duplicate as the primary selection after Ctrl+D", async () => {
    const { savedGraph, selectNode } = renderGraphPanel({ initialSelectedNodeId: "outside" });
    const knownIds = new Set(baseGraph.nodes.map((node) => node.id));

    fireEvent.click(screen.getByRole("group", { name: /Outside/ }));
    pressCanvasKey("d", { ctrlKey: true });

    await waitFor(
      () => {
        const last = savedGraph();
        expect(last ? last.nodes.length : 0).toBe(baseGraph.nodes.length + 1);
      },
      { timeout: 3000 },
    );
    const duplicate = savedGraph().nodes.find((node) => !knownIds.has(node.id));
    const calls = selectNode.mock.calls;
    expect(calls[calls.length - 1]?.[0]).toBe(duplicate?.id);
  });
});
