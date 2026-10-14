// @vitest-environment jsdom

import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  chooseFromContextMenu,
  clickEmptyCanvas,
  nodeCard,
  flowEdgeElement,
  pressCanvasKey,
  installReactFlowLayoutShims,
  renderNoteGraph,
  renderedConnectorIds,
} from "./renderNoteGraph";
import type { NoteGraph } from "@loam/shared/notes/noteModel";

installReactFlowLayoutShims();

const graph: NoteGraph = {
  enabled: true,
  nodes: [
    { id: "a", title: "Draft plan", position: { x: 0, y: 0 }, size: { width: 224, height: 84 } },
    { id: "b", title: "Ship", position: { x: 400, y: 0 }, size: { width: 224, height: 84 } },
  ],
  edges: [{ id: "a-b", source: "a", target: "b", label: "leads" }],
  viewport: { x: 0, y: 0, zoom: 1 },
};

const undo = () => fireEvent.click(screen.getByRole("button", { name: "Undo" }));
const openDetails = () => fireEvent.click(screen.getByRole("button", { name: "Details" }));
const details = (kind: "Node" | "Connector") =>
  screen.queryByRole("complementary", { name: `${kind} details` });

describe("selection toolbar and details", () => {
  it("opens details only from the toolbar, and closes them with the selection", async () => {
    const { container } = renderNoteGraph(graph, { selectedNodeId: "a" });
    expect(screen.getByRole("toolbar", { name: "Selection actions" })).toBeTruthy();
    expect(details("Node")).toBeNull();

    openDetails();
    expect(details("Node")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close details" }));
    expect(details("Node")).toBeNull();
    expect(screen.getByRole("toolbar", { name: "Selection actions" })).toBeTruthy();

    openDetails();
    clickEmptyCanvas(container);
    await waitFor(() => expect(details("Node")).toBeNull());
  });

  it("opens a card's details when it is double-clicked, or from Properties", async () => {
    renderNoteGraph(graph);
    fireEvent.doubleClick(nodeCard("Ship"));
    expect(details("Node")).toBeTruthy();
    // Its title is still edited on the card, with Enter.
    expect(screen.queryByRole("textbox", { name: "Node title" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Close details" }));
    await chooseFromContextMenu(nodeCard("Draft plan"), /^Properties$/);
    await waitFor(() => expect(details("Node")).toBeTruthy());
  });

  it("colors every selected node from the toolbar", async () => {
    const { savedGraph } = renderNoteGraph(graph, { selectedNodeId: "a" });
    pressCanvasKey("a", { ctrlKey: true });

    fireEvent.pointerDown(screen.getByRole("button", { name: "Color" }), { button: 0 });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Color green" }));

    await waitFor(() =>
      expect(savedGraph().nodes.map((node) => node.color)).toEqual(["green", "green"]),
    );
  });

  it("trims notes when the field is left, in the same undo step as the typing", async () => {
    const { savedGraph } = renderNoteGraph(graph, { selectedNodeId: "a" });
    openDetails();
    const notes = screen.getByRole("textbox", { name: "Notes" });

    fireEvent.change(notes, { target: { value: "watch the open " } });
    // Spaces survive while typing; only leaving the field trims them.
    expect(savedGraph().nodes[0]?.notes).toBe("watch the open ");
    fireEvent.blur(notes, { target: { value: "watch the open " } });
    expect(savedGraph().nodes[0]?.notes).toBe("watch the open");

    undo();
    await waitFor(() => expect(savedGraph().nodes[0]?.notes).toBeUndefined());
  });

  it("edits the selected connector's label", async () => {
    const { container, savedGraph } = renderNoteGraph(graph);
    await waitFor(() => expect(renderedConnectorIds(container)).toEqual(["a-b"]));
    fireEvent.click(flowEdgeElement(container, "a-b"));
    openDetails();

    const label = screen.getByRole("textbox", { name: "Label" });
    fireEvent.change(label, { target: { value: "leads to " } });
    fireEvent.blur(label, { target: { value: "leads to " } });

    expect(savedGraph().edges[0]?.label).toBe("leads to");
    undo();
    await waitFor(() => expect(savedGraph().edges[0]?.label).toBe("leads"));
  });

  it("locks a node so its notes can no longer change", async () => {
    const { savedGraph } = renderNoteGraph(graph, { selectedNodeId: "a" });

    fireEvent.click(screen.getByRole("button", { name: "Lock selection" }));
    await waitFor(() => expect(savedGraph().nodes[0]?.locked).toBe(true));
    openDetails();
    fireEvent.change(screen.getByRole("textbox", { name: "Notes" }), {
      target: { value: "Changed" },
    });

    expect(savedGraph().nodes[0]?.notes).toBeUndefined();
  });
});
