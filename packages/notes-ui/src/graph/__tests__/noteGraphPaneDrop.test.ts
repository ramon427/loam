import { describe, expect, it } from "vitest";

import { resolveNoteGraphPaneDrop } from "../noteGraphPaneDrop";

const png = new File(["x"], "chart.png", { type: "image/png" });
const text = new File(["x"], "note.txt", { type: "text/plain" });

type PaneDrop = Parameters<typeof resolveNoteGraphPaneDrop>[0];

const drop: PaneDrop = {
  clientX: 8,
  clientY: 16,
  files: [],
  hasNode: () => false,
  readOnly: false,
  screenToFlowPosition: ({ x, y }) => ({ x, y }),
  shapeData: "",
  targetNodeId: null,
};

describe("resolveNoteGraphPaneDrop", () => {
  it.each<{ name: string; input: Partial<PaneDrop>; expected: unknown }>([
    {
      name: "an image onto an existing node",
      input: { files: [png], hasNode: (nodeId) => nodeId === "n1", targetNodeId: "n1" },
      expected: { type: "image-on-node", file: png, nodeId: "n1" },
    },
    {
      name: "images onto the empty canvas",
      input: {
        clientX: 40,
        clientY: 80,
        files: [png],
        screenToFlowPosition: ({ x, y }) => ({ x: x / 2, y: y / 2 }),
        shapeData: "process",
      },
      expected: { type: "images-on-canvas", files: [png], position: { x: 20, y: 40 } },
    },
    {
      name: "a toolbar shape payload, even read-only and carrying a non-image file",
      input: {
        files: [text],
        readOnly: true,
        screenToFlowPosition: ({ x, y }) => ({ x: x + 1, y: y + 1 }),
        shapeData: "decision",
      },
      expected: { type: "create-node", shape: "decision", position: { x: 9, y: 17 } },
    },
    {
      name: "the image toolbar payload",
      input: { shapeData: "image" },
      expected: { type: "create-node", shape: "image", position: { x: 8, y: 16 } },
    },
    {
      name: "a payload without a flow position as ignored",
      input: { screenToFlowPosition: () => null, shapeData: "process" },
      expected: { type: "ignore" },
    },
  ])("resolves $name", ({ input, expected }) => {
    expect(resolveNoteGraphPaneDrop({ ...drop, ...input })).toEqual(expected);
  });
});
