import { describe, expect, it } from "vitest";

import { parseNoteGraphMermaid } from "../parseNoteGraphMermaid";

describe("Mermaid import", () => {
  it("imports Mermaid flowchart lines with labels and plain links", () => {
    const parsed = parseNoteGraphMermaid(
      [
        "flowchart LR",
        "  A[Setup] -->|confirmed| B[Entry]",
        "  B --> C[Management]",
        "  C --- D[Note]",
      ].join("\n"),
    );
    expect(parsed.nodes).toHaveLength(4);
    expect(parsed.edges).toHaveLength(3);
    const byTitle = new Map(parsed.nodes.map((node) => [node.title, node.id]));
    const labeled = parsed.edges.find((edge) => edge.label === "confirmed");
    expect(labeled?.source).toBe(byTitle.get("Setup"));
    expect(labeled?.target).toBe(byTitle.get("Entry"));
    const plain = parsed.edges.find((edge) => {
      const source = parsed.nodes.find((node) => node.id === edge.source);
      return source?.title === "Management";
    });
    expect(plain?.direction).toBe("none");
    expect(() => parseNoteGraphMermaid("")).toThrow(/No Mermaid/);
  });

  it("imports quoted Mermaid labels, two-way and dotted links", () => {
    const parsed = parseNoteGraphMermaid(
      [
        "flowchart TD",
        '  n0["Plan: draft #quot;v2#quot; #91;wip#93;"] <-->|"needs review"| n1{"Ready?"}',
        '  n1 -.- n2("Ship")',
      ].join("\n"),
    );
    expect(parsed.nodes.map((node) => node.title)).toEqual([
      'Plan: draft "v2" [wip]',
      "Ready?",
      "Ship",
    ]);
    expect(parsed.edges.map((edge) => [edge.label, edge.direction ?? "end"])).toEqual([
      ["needs review", "both"],
      [undefined, "none"],
    ]);
  });
});
