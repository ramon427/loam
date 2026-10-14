import { describe, expect, it } from "vitest";

import {
  clampNoteGraphNodeSize,
  estimateNoteGraphNodeSize,
  noteGraphNodeDefaultSize,
  noteGraphNodeSizeLimits,
} from "../noteGraphGeometry";

describe("noteGraphGeometry", () => {
  it("keeps the default size for short single-line content", () => {
    expect(estimateNoteGraphNodeSize({ title: "Setup", shape: "process" })).toEqual(
      noteGraphNodeDefaultSize,
    );
  });

  it("grows nodes so long titles and notes do not overflow", () => {
    const withNotes = estimateNoteGraphNodeSize({
      title: "Risk rules",
      notes:
        "Read the brief twice before starting. Skip the draft when the sources disagree. Write down every open question first. Never publish a claim you cannot cite.",
      shape: "process",
    });
    expect(withNotes.height).toBeGreaterThan(noteGraphNodeDefaultSize.height);

    const veryLong = estimateNoteGraphNodeSize({
      title: "Playbook",
      notes: "Rule one. ".repeat(120),
      shape: "process",
    });
    expect(veryLong.height).toBeGreaterThan(withNotes.height);
    expect(veryLong.height).toBeLessThanOrEqual(noteGraphNodeSizeLimits.maxHeight);
    expect(veryLong.width).toBeLessThanOrEqual(noteGraphNodeSizeLimits.maxWidth);
  });

  it("prefers wider nodes over very tall ones for heavy content", () => {
    const size = estimateNoteGraphNodeSize({
      title: "A very long node title that keeps going and going past two full lines of text",
      notes: "Rule one. ".repeat(120),
      shape: "process",
    });
    expect(size.width).toBeGreaterThan(noteGraphNodeDefaultSize.width);
    expect(size.height).toBeLessThanOrEqual(noteGraphNodeSizeLimits.maxHeight);
  });

  it("clamps sizes into the resizable bounds", () => {
    expect(clampNoteGraphNodeSize({ width: 10, height: 10_000 })).toEqual({
      width: noteGraphNodeSizeLimits.minWidth,
      height: noteGraphNodeSizeLimits.maxHeight,
    });
  });
});
