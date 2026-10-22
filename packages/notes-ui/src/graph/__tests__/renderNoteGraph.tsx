import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { vi } from "vitest";

import { NoteGraphPanel, type NoteGraphPanelProps } from "../NoteGraphPanel";
import type { NoteDocument } from "../../workspace/types";
import type { NoteGraph } from "@loam/shared/notes/noteModel";

/**
 * jsdom has no layout. React Flow measures nodes through offsetWidth/offsetHeight when its
 * ResizeObserver reports them, and only draws connectors between measured nodes, so report
 * the inline size React Flow sets on each node and observe the way browsers do: once, soon
 * after `observe`.
 */
export function installReactFlowLayoutShims() {
  globalThis.ResizeObserver = class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      queueMicrotask(() => {
        const { offsetWidth: width, offsetHeight: height } = target as HTMLElement;
        this.callback(
          [{ target, contentRect: { width, height } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      });
    }
    unobserve() {}
    disconnect() {}
  };
  // React Flow measures connector labels.
  Object.defineProperty(SVGElement.prototype, "getBBox", {
    configurable: true,
    value: () => new DOMRect(0, 0, 40, 16),
  });
  // React Flow reads the zoom from the viewport transform when it refreshes node internals.
  globalThis.DOMMatrixReadOnly = class {
    m22 = 1;
  } as unknown as typeof DOMMatrixReadOnly;
  // The canvas is a 1600 by 900 window, so React Flow draws everything in these tests.
  const canvasSize = { width: 1600, height: 900 };
  for (const [property, axis] of [
    ["offsetWidth", "width"],
    ["offsetHeight", "height"],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, property, {
      configurable: true,
      get(this: HTMLElement) {
        if (this.classList.contains("react-flow__renderer")) return canvasSize[axis];
        return this.style[axis].endsWith("px") ? Number.parseFloat(this.style[axis]) : 0;
      },
    });
  }
}

const graphNote: NoteDocument = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Graph note",
  updatedAt: "2026-07-21T00:00:00.000Z",
  tabs: [
    { id: "text-tab", title: "Text", kind: "page" },
    { id: "graph-tab", title: "Graph", kind: "graph" },
  ],
  blocksByTab: { "text-tab": [], "graph-tab": [] },
  activeTabId: "graph-tab",
};

/**
 * Renders the graph panel inside an owner that stores every published graph, the way the
 * notes workspace does, so tests can read what would be saved.
 */
export function renderNoteGraph(
  initialGraph: NoteGraph,
  options: {
    selectedNodeId?: string | null;
    readOnly?: boolean;
    panelProps?: Partial<NoteGraphPanelProps>;
    /** Rendered next to the graph, for shortcuts that compete with it. */
    outside?: ReactNode;
  } = {},
) {
  const published: NoteGraph[] = [];
  const onSelectNode = vi.fn();
  const onInsertSnapshot = vi.fn(() => true);
  /** `external` stands in for a change made outside the canvas, such as an AI edit. */
  function Owner({ external }: { external: NoteGraph | null }) {
    const [graph, setGraph] = useState(initialGraph);
    const [seenExternal, setSeenExternal] = useState(external);
    if (external !== seenExternal) {
      setSeenExternal(external);
      if (external) setGraph(external);
    }
    const [selectedNodeId, setSelectedNodeId] = useState(options.selectedNodeId ?? null);
    const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
    return (
      <NoteGraphPanel
        graph={graph}
        headingOptions={[]}
        note={graphNote}
        onAddGraph={() => undefined}
        onInsertSnapshot={onInsertSnapshot}
        onOpenHeading={() => undefined}
        onSelectEdge={setSelectedEdgeId}
        onSelectNode={(nodeId) => {
          onSelectNode(nodeId);
          setSelectedNodeId(nodeId);
        }}
        onToggleHeadingConnection={() => undefined}
        onUpdateGraph={(next) => {
          if (!next) return;
          published.push(next);
          setGraph(next);
        }}
        readOnly={options.readOnly ?? false}
        selectedEdgeId={selectedEdgeId}
        selectedNodeId={selectedNodeId}
        tabId="graph-tab"
        {...options.panelProps}
      />
    );
  }
  const tree = (external: NoteGraph | null) => (
    <>
      {options.outside}
      <Owner external={external} />
    </>
  );
  const view = render(tree(null));
  return {
    ...view,
    onSelectNode,
    onInsertSnapshot,
    /** The graph the owner would save, or the initial graph before any publish. */
    savedGraph: () => published.at(-1) ?? initialGraph,
    /** Replaces the graph from outside the canvas. */
    replaceGraph: (next: NoteGraph) => view.rerender(tree(next)),
  };
}

export const graphPane = () => screen.getByRole("region", { name: "Note graph canvas" });

/** Presses a key on whatever has focus, the way a keyboard user would. */
export function pressKey(key: string, init: Omit<KeyboardEventInit, "key"> = {}) {
  const target = document.activeElement ?? document.body;
  fireEvent.keyDown(target, { key, ...init });
  fireEvent.keyUp(target, { key, ...init });
}

/** Focuses the canvas and presses a key there. */
export function pressCanvasKey(key: string, init: Omit<KeyboardEventInit, "key"> = {}) {
  graphPane().focus();
  pressKey(key, init);
}

export const nodeCard = (name: string | RegExp) =>
  screen.getByRole("group", { name: typeof name === "string" ? new RegExp(name) : name });

/** Opens the canvas context menu on an element and picks an item. */
export async function chooseFromContextMenu(target: Element, item: RegExp) {
  fireEvent.contextMenu(target, { clientX: 120, clientY: 150 });
  fireEvent.click(await screen.findByRole("menuitem", { name: item }));
}

export const flowNodeElement = (container: HTMLElement, id: string) =>
  container.querySelector(`.react-flow__node[data-id="${id}"]`)!;

export const flowEdgeElement = (container: HTMLElement, id: string) =>
  container.querySelector(`.react-flow__edge[data-id="${id}"]`)!;

/** What the canvas last announced to screen readers. */
export const announcement = () => within(graphPane()).getByRole("status", { name: "" }).textContent;

/** Clicks empty canvas the way a mouse does: press and release without moving. */
export function clickEmptyCanvas(container: HTMLElement) {
  const pane = container.querySelector(".react-flow__pane")!;
  const point = { button: 0, pointerId: 1, isPrimary: true, clientX: 900, clientY: 700 };
  fireEvent.pointerDown(pane, point);
  fireEvent.pointerUp(pane, point);
  fireEvent.click(pane, point);
}

export const renderedConnectorIds = (container: HTMLElement) =>
  Array.from(container.querySelectorAll(".react-flow__edge")).map((edge) =>
    edge.getAttribute("data-id"),
  );
