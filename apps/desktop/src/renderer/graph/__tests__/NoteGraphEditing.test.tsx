// @vitest-environment jsdom

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  installReactFlowLayoutShims,
  nodeCard,
  pressCanvasKey,
  pressKey,
  renderNoteGraph,
  renderedConnectorIds,
} from "./renderNoteGraph";
import type { NoteGraph, NoteGraphNode } from "@loam/shared/notes/noteModel";

installReactFlowLayoutShims();

const node = (
  id: string,
  title: string,
  x: number,
  y: number,
  extra: Partial<NoteGraphNode> = {},
) =>
  ({
    id,
    title,
    position: { x, y },
    size: { width: 120, height: 60 },
    shape: "process",
    ...extra,
  }) satisfies NoteGraphNode;

const graphOf = (nodes: NoteGraphNode[], edges: NoteGraph["edges"] = []): NoteGraph => ({
  enabled: true,
  nodes,
  edges,
  viewport: { x: 0, y: 0, zoom: 1 },
});

describe("editing a note graph", () => {
  it("keeps a renamed title and connects the new node when Tab chains from it", async () => {
    const { savedGraph } = renderNoteGraph(graphOf([node("old", "Old", 0, 0)]), {
      selectedNodeId: "old",
    });

    pressCanvasKey("Enter");
    const title = screen.getByRole("textbox", { name: "Node title" });
    fireEvent.change(title, { target: { value: "Renamed" } });
    fireEvent.keyDown(title, { key: "Tab" });

    await waitFor(() => expect(savedGraph().nodes).toHaveLength(2));
    const saved = savedGraph();
    const added = saved.nodes.find((candidate) => candidate.id !== "old")!;
    expect(saved.nodes.map((candidate) => candidate.title)).toEqual(["Renamed", "New node"]);
    expect(saved.edges).toEqual([expect.objectContaining({ source: "old", target: added.id })]);
  });

  it("saves the text typed into a text node", async () => {
    const { savedGraph } = renderNoteGraph(
      graphOf([
        node("text", "Text", 0, 0, { shape: "text", notes: "", size: { width: 200, height: 48 } }),
      ]),
    );

    fireEvent.doubleClick(nodeCard("text node"));
    const text = screen.getByRole("textbox", { name: "Text content" });
    fireEvent.change(text, { target: { value: "hello" } });
    fireEvent.keyDown(text, { key: "Enter", ctrlKey: true });

    await waitFor(() => expect(savedGraph().nodes[0]?.notes).toBe("hello"));
  });

  it("ignores canvas keys while a snapshot area is being selected", async () => {
    const { savedGraph } = renderNoteGraph(graphOf([node("kept", "Kept", 0, 0)]), {
      selectedNodeId: "kept",
    });
    const capture = screen.getByRole("button", { name: "Capture graph snapshot" });
    await waitFor(() => expect(capture.hasAttribute("disabled")).toBe(false));

    fireEvent.click(capture);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Select graph snapshot area");
    pressKey("Delete");
    pressKey("ArrowRight");

    expect(nodeCard("Kept")).toBeTruthy();
    expect(savedGraph().nodes).toEqual([node("kept", "Kept", 0, 0)]);
  });

  it("shows a frame member's connectors again after undoing the collapse", async () => {
    const { container } = renderNoteGraph(
      graphOf(
        [
          node("frame", "Group", 0, 0, { shape: "frame", size: { width: 480, height: 320 } }),
          node("member", "Inside", 40, 200),
          node("outside", "Outside", 800, 200),
        ],
        [{ id: "link", source: "member", target: "outside" }],
      ),
    );
    await waitFor(() => expect(renderedConnectorIds(container)).toEqual(["link"]));

    fireEvent.click(
      within(nodeCard("Frame: Group")).getByRole("button", { name: "Collapse frame" }),
    );
    await waitFor(() => expect(renderedConnectorIds(container)).toEqual([]));

    pressCanvasKey("z", { ctrlKey: true });

    await waitFor(() => expect(nodeCard("Inside")).toBeTruthy());
    await waitFor(() => expect(renderedConnectorIds(container)).toEqual(["link"]));
  });

  it("keeps heading links changed outside the canvas when the node is edited next", async () => {
    const linked = node("linked", "Linked", 0, 0, { headingBlockIds: ["heading-a"] });
    const { savedGraph, replaceGraph } = renderNoteGraph(graphOf([linked]), {
      selectedNodeId: "linked",
    });

    replaceGraph(graphOf([{ ...linked, headingBlockIds: ["heading-b"] }]));
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Notes" }), {
      target: { value: "Renamed" },
    });

    await waitFor(() => expect(savedGraph().nodes[0]?.notes).toBe("Renamed"));
    expect(savedGraph().nodes[0]?.headingBlockIds).toEqual(["heading-b"]);
  });

  it("shows a graph changed outside the canvas, and undo still restores edits made here", async () => {
    const { savedGraph, replaceGraph } = renderNoteGraph(graphOf([node("a", "A", 0, 0)]));

    replaceGraph(graphOf([node("a", "A", 0, 0), node("b", "Added by AI", 300, 0)]));
    expect(nodeCard("Added by AI")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Decision" }));
    await waitFor(() => expect(savedGraph().nodes).toHaveLength(3));

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(() =>
      expect(savedGraph().nodes.map((item) => item.title)).toEqual(["A", "Added by AI"]),
    );
  });
});
