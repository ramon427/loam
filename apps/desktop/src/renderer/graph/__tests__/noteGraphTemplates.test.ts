import { describe, expect, it } from "vitest";

import { noteGraphTemplates } from "../noteGraphTemplates";

describe("noteGraphTemplates", () => {
  it("builds valid templates with resolvable edges", () => {
    noteGraphTemplates.forEach((template) => {
      const built = template.build();
      expect(built.nodes.length).toBeGreaterThan(0);
      const ids = new Set(built.nodes.map((node) => node.id));
      expect(ids.size).toBe(built.nodes.length);
      built.edges.forEach((edge) => {
        expect(ids.has(edge.source)).toBe(true);
        expect(ids.has(edge.target)).toBe(true);
      });
    });
  });
});
