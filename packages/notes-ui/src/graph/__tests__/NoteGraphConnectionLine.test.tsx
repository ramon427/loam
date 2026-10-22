// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { Position, type ConnectionLineComponentProps } from "@xyflow/react";
import { describe, expect, it, vi } from "vitest";
import {
  NoteGraphConnectionLine,
  NoteGraphNewNodePreviewContext,
} from "../NoteGraphConnectionLine";
import { toFlowNodes, type GraphFlowNode } from "../noteGraphFlowElements";

const state = vi.hoisted(() => ({ nodes: [] as GraphFlowNode[] }));
vi.mock("@xyflow/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@xyflow/react")>()),
  useNodes: () => state.nodes,
}));

describe("connection drop preview", () => {
  it("centers the preview in flow coordinates and hides it over a node or snapped handle", () => {
    state.nodes = toFlowNodes({
      nodes: [
        {
          id: "target",
          title: "Target",
          position: { x: 300, y: 200 },
          size: { width: 224, height: 84 },
        },
      ],
      hiddenIds: new Set(),
      selectedIds: new Set(),
      measured: new Map(),
      transient: new Map(),
      decorations: new Map(),
    });
    const props = {
      fromX: 0,
      fromY: 0,
      fromPosition: Position.Right,
      toX: 100,
      toY: 100,
      toPosition: Position.Left,
      toNode: null,
      toHandle: null,
    } as ConnectionLineComponentProps<GraphFlowNode>;
    const { container, rerender } = render(
      <svg>
        <NoteGraphConnectionLine {...props} />
      </svg>,
    );
    const preview = container.querySelector("rect");
    expect(preview?.getAttribute("x")).toBe("-12");
    expect(preview?.getAttribute("y")).toBe("58");
    rerender(
      <svg>
        <NoteGraphConnectionLine {...props} toX={400} toY={240} />
      </svg>,
    );
    expect(container.querySelector("rect")).toBeNull();
    rerender(
      <svg>
        <NoteGraphConnectionLine
          {...props}
          toNode={{ id: "target" } as ConnectionLineComponentProps<GraphFlowNode>["toNode"]}
        />
      </svg>,
    );
    expect(container.querySelector("rect")).toBeNull();
    expect(container.querySelector("path")).not.toBeNull();
    rerender(
      <NoteGraphNewNodePreviewContext value={false}>
        <svg>
          <NoteGraphConnectionLine {...props} />
        </svg>
      </NoteGraphNewNodePreviewContext>,
    );
    expect(container.querySelector("rect")).toBeNull();
  });
});
