import { describe, expect, it } from "vitest";

import { noteGraphNodeSizeLimits } from "../noteGraphGeometry";
import { noteGraphSchema } from "../noteGraphSchema";

const graphWith = (node: Record<string, unknown>) => ({
  enabled: true,
  nodes: [{ id: "a", title: "A", position: { x: 0, y: 0 }, ...node }],
  edges: [],
});

const accepts = (node: Record<string, unknown>) =>
  noteGraphSchema.safeParse(graphWith(node)).success;

describe("noteGraphSchema", () => {
  it("accepts nodes within the editor's size limits and refuses larger ones", () => {
    const { minWidth, maxWidth, minHeight, maxHeight } = noteGraphNodeSizeLimits;
    expect(accepts({ size: { width: minWidth, height: minHeight } })).toBe(true);
    expect(accepts({ size: { width: maxWidth, height: maxHeight } })).toBe(true);
    expect(accepts({ size: { width: maxWidth + 1, height: maxHeight } })).toBe(false);
    expect(accepts({ size: { width: minWidth, height: minHeight - 1 } })).toBe(false);
  });

  it("keeps accepting nodes 520 tall that older graphs may hold", () => {
    expect(accepts({ size: { width: 224, height: 520 } })).toBe(true);
    expect(accepts({ size: { width: 224, height: 521 } })).toBe(false);
  });

  it("accepts the palette colours and hex colours only", () => {
    expect(accepts({ color: "purple", colorHex: "#0ea5e9" })).toBe(true);
    expect(accepts({ colorHex: "#abc" })).toBe(true);
    expect(accepts({ color: "teal" })).toBe(false);
    expect(accepts({ colorHex: "blue" })).toBe(false);
  });
});
