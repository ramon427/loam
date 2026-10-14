import { describe, expect, it } from "vitest";

import { readNoteGraphImport } from "../noteGraphImport";

const importCanvas = (node: Record<string, unknown>, edges: unknown[] = []) =>
  JSON.stringify({
    nodes: [
      { id: "a", type: "text", text: "Alpha", x: 0, y: 0, width: 200, height: 80, ...node },
      { id: "b", type: "text", text: "Beta", x: 300, y: 0, width: 200, height: 80 },
    ],
    edges,
  });

const empty = { nodes: [], edges: [] };

describe("graph import", () => {
  it("reads a canvas that Notes can save", () => {
    const result = readNoteGraphImport("jsoncanvas", importCanvas({}), empty);

    expect("parts" in result && result.parts.nodes.map((node) => node.title)).toEqual([
      "Alpha",
      "Beta",
    ]);
  });

  it.each([
    ["an overlong node body", importCanvas({ text: `Alpha\n${"x".repeat(1_001)}` })],
    ["a colour that is not a hex value", importCanvas({ color: "#invalid" })],
    [
      "an overlong connector label",
      importCanvas({}, [{ id: "e", fromNode: "a", toNode: "b", label: "l".repeat(121) }]),
    ],
  ])("refuses %s, naming the item at fault", (_label, canvas) => {
    expect(readNoteGraphImport("jsoncanvas", canvas, empty)).toEqual({
      error: expect.stringMatching(/^(Node|Connector) 1/),
    });
  });

  it("reports text with no nodes and text that does not parse", () => {
    expect(readNoteGraphImport("jsoncanvas", '{"nodes":[],"edges":[]}', empty)).toEqual({
      error: "Nothing to import: no nodes were found.",
    });
    expect(readNoteGraphImport("jsoncanvas", "{", empty)).toEqual({ error: expect.any(String) });
  });
});
