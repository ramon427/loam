import { describe, expect, it } from "vitest";

import { sortByPosition } from "../sortByPosition";

describe("sortByPosition", () => {
  it("sorts by position, a missing one counting as the item's index, ties in given order", () => {
    const sorted = sortByPosition([
      { id: "b", position: 2 },
      { id: "a" },
      { id: "c", position: 1 },
      { id: "d", position: 1 },
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["a", "c", "d", "b"]);
  });
});
