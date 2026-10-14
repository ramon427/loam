// @vitest-environment jsdom

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  announcement,
  chooseFromContextMenu,
  clickEmptyCanvas,
  flowEdgeElement,
  flowNodeElement,
  graphPane,
  installReactFlowLayoutShims,
  nodeCard,
  pressCanvasKey,
  renderNoteGraph,
  renderedConnectorIds,
} from "./renderNoteGraph";
import type { NoteGraph, NoteGraphNode } from "@loam/shared/notes/noteModel";

const media = vi.hoisted(() => ({ uploadImage: vi.fn() }));
vi.mock("../../media/useImageUpload", () => ({
  useImageUpload: () => ({ isUploading: false, error: null, uploadImage: media.uploadImage }),
}));
vi.mock("../../media/useImageUrl", () => ({
  useImageUrl: (path?: string | null) => ({
    url: path ? `https://images.example.test/${path}` : "",
    resolvedPath: path ?? null,
    isLoading: false,
    refresh: () => undefined,
  }),
}));

installReactFlowLayoutShims();

const node = (
  id: string,
  title: string,
  x: number,
  y: number,
  extra: Partial<NoteGraphNode> = {},
): NoteGraphNode => ({
  id,
  title,
  position: { x, y },
  size: { width: 224, height: 84 },
  shape: "process",
  color: "blue",
  ...extra,
});

const graph: NoteGraph = {
  enabled: true,
  nodes: [node("a", "Alpha", 0, 0), node("b", "Beta", 400, 0), node("c", "Gamma", 0, 240)],
  edges: [{ id: "a-b", source: "a", target: "b" }],
  viewport: { x: 0, y: 0, zoom: 1 },
};

const titles = (saved: NoteGraph) => saved.nodes.map((item) => item.title);

describe("note graph canvas", () => {
  it("adds a shape from the toolbar and selects it", async () => {
    const { savedGraph, onSelectNode } = renderNoteGraph(graph);

    fireEvent.click(screen.getByRole("button", { name: "Decision" }));

    await waitFor(() => expect(savedGraph().nodes).toHaveLength(4));
    const added = savedGraph().nodes.find((item) => item.shape === "decision")!;
    expect(onSelectNode).toHaveBeenLastCalledWith(added.id);
  });

  const doubleClickEmptyCanvas = async (container: HTMLElement) => {
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Capture graph snapshot" }).hasAttribute("disabled"),
      ).toBe(false),
    );
    fireEvent.doubleClick(container.querySelector(".react-flow__pane")!, {
      clientX: 600,
      clientY: 400,
    });
  };

  it("starts a text on a double-click on empty canvas and keeps what is written", async () => {
    const { container, savedGraph } = renderNoteGraph(graph);
    await doubleClickEmptyCanvas(container);

    const field = await screen.findByRole("textbox", { name: "Text content" });
    expect(field).toBe(document.activeElement);
    fireEvent.change(field, { target: { value: "Written anywhere" } });
    fireEvent.blur(field);

    await waitFor(() =>
      expect(savedGraph().nodes.at(-1)).toMatchObject({ shape: "text", notes: "Written anywhere" }),
    );
  });

  it("drops a text left unwritten", async () => {
    const { container, savedGraph } = renderNoteGraph(graph);
    await doubleClickEmptyCanvas(container);
    await waitFor(() => expect(savedGraph().nodes).toHaveLength(4));

    fireEvent.blur(await screen.findByRole("textbox", { name: "Text content" }));

    await waitFor(() => expect(savedGraph().nodes).toHaveLength(3));
  });

  it("edits a connector label on double-click instead of creating a node", async () => {
    const { container, savedGraph } = renderNoteGraph(graph);
    await waitFor(() => expect(renderedConnectorIds(container)).toEqual(["a-b"]));

    fireEvent.doubleClick(flowEdgeElement(container, "a-b"));
    const label = screen.getByRole("textbox", { name: "Connector label" });
    fireEvent.change(label, { target: { value: "leads to" } });
    fireEvent.keyDown(label, { key: "Enter" });

    await waitFor(() => expect(savedGraph().edges[0]?.label).toBe("leads to"));
    expect(savedGraph().nodes).toHaveLength(3);
  });

  it("selects a clicked connector and deletes it with the keyboard", async () => {
    const { container, savedGraph } = renderNoteGraph(graph);
    await waitFor(() => expect(renderedConnectorIds(container)).toEqual(["a-b"]));

    fireEvent.click(flowEdgeElement(container, "a-b"));
    expect(screen.getByRole("button", { name: "Connector path" })).toBeTruthy();
    pressCanvasKey("Delete");

    await waitFor(() => expect(savedGraph().edges).toEqual([]));
    expect(titles(savedGraph())).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("clears the selection when empty canvas is clicked", async () => {
    const { container, onSelectNode } = renderNoteGraph(graph, { selectedNodeId: "a" });
    expect(screen.getByRole("toolbar", { name: "Selection actions" })).toBeTruthy();

    clickEmptyCanvas(container);

    await waitFor(() =>
      expect(screen.queryByRole("toolbar", { name: "Selection actions" })).toBeNull(),
    );
    expect(onSelectNode).toHaveBeenLastCalledWith(null);
  });

  it("selects everything, copies and pastes it with the keyboard", async () => {
    const { savedGraph } = renderNoteGraph(graph);

    pressCanvasKey("a", { ctrlKey: true });
    expect(screen.getByRole("button", { name: "Align selection" })).toBeTruthy();
    pressCanvasKey("c", { ctrlKey: true });
    pressCanvasKey("v", { ctrlKey: true });
    // The browser follows Ctrl+V with a paste event, carrying whatever the system clipboard has.
    fireEvent.paste(graphPane(), { clipboardData: { files: [], getData: () => "copied text" } });

    await waitFor(() => expect(savedGraph().nodes).toHaveLength(6));
    expect(titles(savedGraph()).slice(3)).toEqual(["Alpha (1)", "Beta (1)", "Gamma (1)"]);
    expect(savedGraph().edges).toHaveLength(2);
  });

  it("renames the selected node with Enter and adds a node with Ctrl+Enter", async () => {
    const { savedGraph } = renderNoteGraph(graph, { selectedNodeId: "b" });

    pressCanvasKey("Enter");
    expect(screen.getByRole("textbox", { name: "Node title" })).toHaveProperty("value", "Beta");
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Node title" }), { key: "Escape" });

    pressCanvasKey("Enter", { ctrlKey: true });
    await waitFor(() => expect(savedGraph().nodes).toHaveLength(4));
    expect(screen.getByRole("textbox", { name: "Node title" })).toHaveProperty("value", "New node");
  });

  it("connects the selected node to the nearest one with keyboard connect mode", async () => {
    const { savedGraph } = renderNoteGraph(graph, { selectedNodeId: "a" });

    pressCanvasKey("c");
    pressCanvasKey("Enter");

    await waitFor(() => expect(savedGraph().edges).toHaveLength(2));
    expect(savedGraph().edges[1]).toMatchObject({ source: "a", target: "c" });
  });

  it("nudges with the arrow keys, and undoes a burst of nudges in one step", async () => {
    const { savedGraph } = renderNoteGraph(graph, { selectedNodeId: "a" });

    pressCanvasKey("ArrowRight");
    pressCanvasKey("ArrowRight", { shiftKey: true });
    pressCanvasKey("ArrowDown");
    await waitFor(() => expect(savedGraph().nodes[0]?.position).toEqual({ x: 11, y: 1 }));

    pressCanvasKey("z", { ctrlKey: true });
    await waitFor(() => expect(savedGraph().nodes[0]?.position).toEqual({ x: 0, y: 0 }));
  });

  it("resizes the selected node from the keyboard in grid steps", async () => {
    const { savedGraph } = renderNoteGraph(graph, { selectedNodeId: "a" });

    pressCanvasKey("ArrowRight", { ctrlKey: true });
    pressCanvasKey("ArrowDown", { ctrlKey: true, shiftKey: true });

    await waitFor(() => expect(savedGraph().nodes[0]?.size).toEqual({ width: 240, height: 144 }));
  });

  it("fits a node to its content when a resize corner is double-clicked", async () => {
    const { container, savedGraph } = renderNoteGraph(
      { ...graph, nodes: [node("a", "Alpha", 0, 0, { size: { width: 400, height: 300 } })] },
      { selectedNodeId: "a" },
    );

    const corner = container.querySelector(".react-flow__resize-control.handle.bottom.right")!;
    fireEvent.doubleClick(corner.firstElementChild!);

    await waitFor(() => expect(savedGraph().nodes[0]?.size?.height).toBeLessThan(300));
  });

  it("keeps canvas settings when a node is edited afterwards", async () => {
    const { savedGraph } = renderNoteGraph(graph, { selectedNodeId: "a" });

    fireEvent.click(screen.getByRole("button", { name: "Graph options" }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Canvas" }), { button: 0 });
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Lines" }));
    await waitFor(() => expect(savedGraph().grid).toBe("lines"));

    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Notes" }), {
      target: { value: "Renamed" },
    });

    await waitFor(() => expect(savedGraph().nodes[0]?.notes).toBe("Renamed"));
    expect(savedGraph().grid).toBe("lines");
  });

  it("seeks the video from a node's timestamp, writing an hour or more with hours", () => {
    const onSeekVideoTimestamp = vi.fn();
    renderNoteGraph(
      {
        ...graph,
        nodes: [
          node("a", "Intro", 0, 0, { timestampSeconds: 75 }),
          node("b", "Outro", 400, 0, { timestampSeconds: 4500 }),
        ],
      },
      { panelProps: { onSeekVideoTimestamp } },
    );

    fireEvent.click(screen.getByRole("button", { name: "Seek video to 1:15" }));

    expect(onSeekVideoTimestamp).toHaveBeenCalledWith(75);
    expect(screen.getByRole("button", { name: "Seek video to 1:15:00" })).toBeTruthy();
  });

  it("names each node for screen readers by kind, title, colour, size and state", () => {
    renderNoteGraph({
      ...graph,
      nodes: [
        node("a", "Alpha", 0, 0, { color: "green", locked: true }),
        node("b", "Chart", 400, 0, { shape: "image", size: { width: 240, height: 176 } }),
        node("c", "", 0, 240, { shape: "frame", size: { width: 480, height: 320 } }),
      ],
    });

    expect(
      screen.getByRole("group", { name: "process node: Alpha, green, 224 by 84 pixels, locked" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("group", { name: "Image node: Chart, 240 by 176 pixels" }),
    ).toBeTruthy();
    expect(screen.getByRole("group", { name: "Frame: Group, 480 by 320 pixels" })).toBeTruthy();
  });

  it("aligns the selection from the selection bar", async () => {
    const { savedGraph } = renderNoteGraph(graph, { selectedNodeId: "a" });
    pressCanvasKey("a", { ctrlKey: true });

    fireEvent.pointerDown(await screen.findByRole("button", { name: "Align selection" }), {
      button: 0,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Center vertically" }));

    // Gamma lands on Alpha, so it is pushed below it afterwards.
    await waitFor(() =>
      expect(
        savedGraph()
          .nodes.map((item) => item.position.y)
          .slice(0, 2),
      ).toEqual([120, 120]),
    );
  });

  it("creates an image node from the toolbar and uploads the picked file into it", async () => {
    media.uploadImage.mockResolvedValue({ path: "user-1/chart.png" });
    const { savedGraph } = renderNoteGraph(graph);

    fireEvent.click(screen.getByRole("button", { name: "Add image" }));
    await waitFor(() => expect(savedGraph().nodes).toHaveLength(4));
    fireEvent.change(screen.getByTestId("note-graph-image-input"), {
      target: { files: [new File(["x"], "chart.png", { type: "image/png" })] },
    });

    await waitFor(() =>
      expect(savedGraph().nodes[3]).toMatchObject({ shape: "image", imageUrl: "user-1/chart.png" }),
    );
    expect(within(nodeCard("Image node")).getByAltText("Image")).toBeTruthy();
  });

  it("puts an image dropped on a node into that node", async () => {
    media.uploadImage.mockResolvedValue({ path: "user-1/photo.png" });
    const { container, savedGraph } = renderNoteGraph(graph);

    fireEvent.drop(flowNodeElement(container, "b"), {
      dataTransfer: {
        files: [new File(["x"], "photo.png", { type: "image/png" })],
        getData: () => "",
      },
    });

    await waitFor(() =>
      expect(savedGraph().nodes[1]).toMatchObject({ id: "b", imageUrl: "user-1/photo.png" }),
    );
  });

  it("walks through the nodes and leaves the walkthrough with Escape", async () => {
    renderNoteGraph(graph);

    fireEvent.click(screen.getByRole("button", { name: "Graph options" }));
    fireEvent.click(screen.getByRole("button", { name: "Start walkthrough" }));
    expect(screen.getByText("1 of 3")).toBeTruthy();
    pressCanvasKey("ArrowRight");
    expect(screen.getByText("2 of 3")).toBeTruthy();

    pressCanvasKey("Escape");

    await waitFor(() => expect(screen.queryByText("2 of 3")).toBeNull());
  });

  it("inserts a template from the Insert menu", async () => {
    const { savedGraph } = renderNoteGraph(graph);

    fireEvent.click(screen.getByRole("button", { name: "Graph options" }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Insert" }), { button: 0 });
    fireEvent.click((await screen.findAllByRole("menuitem"))[0]!);

    await waitFor(() => expect(savedGraph().nodes.length).toBeGreaterThan(3));
  });
});

describe("note graph context menu", () => {
  it("deletes the right-clicked node rather than the selected one, and undo restores it", async () => {
    const { container, savedGraph } = renderNoteGraph(graph, { selectedNodeId: "a" });

    await chooseFromContextMenu(flowNodeElement(container, "b"), /^Delete/);

    await waitFor(() => expect(titles(savedGraph())).toEqual(["Alpha", "Gamma"]));
    expect(savedGraph().edges).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(titles(savedGraph())).toEqual(["Alpha", "Beta", "Gamma"]));
    expect(savedGraph().edges).toHaveLength(1);
  });

  it("acts on the whole selection when a selected node is right-clicked", async () => {
    const { container, savedGraph } = renderNoteGraph(graph);
    pressCanvasKey("a", { ctrlKey: true });

    await chooseFromContextMenu(flowNodeElement(container, "b"), /^Delete 3 selected/);

    await waitFor(() => expect(savedGraph().nodes).toEqual([]));
  });

  it("deletes a right-clicked connector and keeps both of its nodes", async () => {
    const { container, savedGraph } = renderNoteGraph(graph);
    await waitFor(() => expect(renderedConnectorIds(container)).toEqual(["a-b"]));

    await chooseFromContextMenu(flowEdgeElement(container, "a-b"), /^Delete connector/);

    await waitFor(() => expect(savedGraph().edges).toEqual([]));
    expect(savedGraph().nodes).toHaveLength(3);
  });

  it("reverses only the right-clicked connector", async () => {
    const { container, savedGraph } = renderNoteGraph({
      ...graph,
      edges: [...graph.edges, { id: "a-c", source: "a", target: "c" }],
    });
    await waitFor(() => expect(renderedConnectorIds(container)).toHaveLength(2));

    await chooseFromContextMenu(flowEdgeElement(container, "a-b"), /^Reverse direction/);

    await waitFor(() =>
      expect(savedGraph().edges).toEqual([
        expect.objectContaining({ id: "a-b", source: "b", target: "a" }),
        expect.objectContaining({ id: "a-c", source: "a", target: "c" }),
      ]),
    );
  });

  it("refuses to reverse a connector onto one that already runs the other way", async () => {
    const { container, savedGraph } = renderNoteGraph({
      ...graph,
      edges: [...graph.edges, { id: "b-a", source: "b", target: "a" }],
    });
    await waitFor(() => expect(renderedConnectorIds(container)).toHaveLength(2));

    await chooseFromContextMenu(flowEdgeElement(container, "a-b"), /^Reverse direction/);

    await waitFor(() => expect(announcement()).toBe("Already connected"));
    expect(savedGraph().edges).toHaveLength(2);
    expect(renderedConnectorIds(container)).toHaveLength(2);
  });

  it("removes a collapsed frame and shows the nodes it hid, with undo", async () => {
    const framed: NoteGraph = {
      ...graph,
      nodes: [
        node("frame", "Group", -40, -40, {
          shape: "frame",
          collapsed: true,
          size: { width: 200, height: 44 },
          expandedSize: { width: 720, height: 420 },
        }),
        ...graph.nodes,
      ],
    };
    const { container, savedGraph } = renderNoteGraph(framed);
    expect(screen.queryByRole("group", { name: /Alpha/ })).toBeNull();

    await chooseFromContextMenu(flowNodeElement(container, "frame"), /^Remove frame/);

    await waitFor(() => expect(titles(savedGraph())).toEqual(["Alpha", "Beta", "Gamma"]));
    expect(nodeCard("Alpha")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(savedGraph().nodes).toHaveLength(4));
  });

  it("does not duplicate past the node limit", async () => {
    const full: NoteGraph = {
      ...graph,
      nodes: [
        ...graph.nodes,
        ...Array.from({ length: 197 }, (_, index) =>
          node(`extra-${index}`, `Extra ${index}`, index * 250, 600),
        ),
      ],
    };
    const { container, savedGraph } = renderNoteGraph(full);

    await chooseFromContextMenu(flowNodeElement(container, "b"), /^Duplicate/);

    await waitFor(() => expect(announcement()).toBe("Node limit reached (200)"));
    expect(savedGraph().nodes).toHaveLength(200);
  });

  it("offers no delete for a locked node", async () => {
    const { container } = renderNoteGraph({
      ...graph,
      nodes: graph.nodes.map((item) => ({ ...item, locked: true })),
    });

    fireEvent.contextMenu(flowNodeElement(container, "b"), { clientX: 120, clientY: 150 });

    const deletion = await screen.findByRole("menuitem", {
      name: "Delete node and its connectors",
    });
    expect(deletion.getAttribute("data-disabled")).not.toBeNull();
  });

  it("shows the menu's shortcuts the way the platform writes them", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const { container } = renderNoteGraph(graph);

    fireEvent.contextMenu(flowNodeElement(container, "b"), { clientX: 120, clientY: 150 });

    const copy = await screen.findByRole("menuitem", { name: "Copy" });
    expect(copy.textContent).toBe("Copy⌘C");
    expect(copy.getAttribute("aria-keyshortcuts")).toBe("Meta+C");
    vi.restoreAllMocks();
  });
});

describe("note graph keyboard ownership", () => {
  it("keeps graph keys inside the graph", async () => {
    const { savedGraph } = renderNoteGraph(graph);

    pressCanvasKey("Enter", { ctrlKey: true });
    await waitFor(() => expect(savedGraph().nodes).toHaveLength(4));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Node title" }), { key: "Escape" });

    pressCanvasKey("f", { ctrlKey: true });
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "Search nodes (Ctrl+F, Enter jumps)" }),
    );
    expect(within(graphPane()).getByRole("search", { name: "Find in graph" })).toBeTruthy();
  });
});
