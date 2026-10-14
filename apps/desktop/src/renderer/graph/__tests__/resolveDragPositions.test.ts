import { describe, expect, it } from "vitest";

import { resolveDragPositions } from "../useNoteGraphFlowBinding";

const size = { width: 100, height: 40 };
const other = { id: "other", title: "Other", position: { x: 300, y: 200 }, size };

const drag = (overrides: Partial<Parameters<typeof resolveDragPositions>[0]> = {}) =>
  resolveDragPositions({
    proposed: new Map([["dragged", { x: 50, y: 10 }]]),
    primary: { id: "dragged", size },
    starts: new Map([["dragged", { x: 0, y: 0 }]]),
    frameMembers: new Map(),
    others: [],
    axisLock: false,
    snapThreshold: 6,
    ...overrides,
  });

describe("dragging nodes", () => {
  it("moves a frame's members by the frame's offset", () => {
    const { positions } = drag({
      starts: new Map([
        ["dragged", { x: 0, y: 0 }],
        ["member", { x: 20, y: 30 }],
      ]),
      frameMembers: new Map([["dragged", ["member"]]]),
    });

    expect(positions.get("member")).toEqual({ x: 70, y: 40 });
  });

  it("keeps to the axis of larger movement while Shift is held", () => {
    expect(drag({ axisLock: true }).positions.get("dragged")).toEqual({ x: 50, y: 0 });
  });

  it("snaps a lone node to a nearby node's edge and shows the guide", () => {
    const { positions, guides } = drag({
      proposed: new Map([["dragged", { x: 296, y: 120 }]]),
      others: [other],
    });

    expect(positions.get("dragged")).toEqual({ x: 300, y: 120 });
    expect(guides).toEqual({ x: 300, y: null });
  });
});
