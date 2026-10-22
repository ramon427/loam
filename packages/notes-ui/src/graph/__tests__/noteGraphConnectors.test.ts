import { describe, expect, it } from "vitest";

import { cycleNoteGraphEdgeType } from "../noteGraphConnectors";

describe("noteGraphConnectors", () => {
  it("cycles connector types", () => {
    expect(cycleNoteGraphEdgeType(undefined)).toBe("bezier");
    expect(cycleNoteGraphEdgeType("bezier")).toBe("straight");
    expect(cycleNoteGraphEdgeType("step")).toBe("smoothstep");
  });
});
