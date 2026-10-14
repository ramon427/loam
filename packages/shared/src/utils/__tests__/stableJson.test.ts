import { describe, expect, it } from "vitest";

import { stableJsonStringify } from "../stableJson";

describe("stableJsonStringify", () => {
  it("orders keys by code unit at every depth, whatever the locale", () => {
    expect(stableJsonStringify({ b: 1, B: 2, a: { z: [{ y: 1, x: 2 }], é: 3, e: 4 } })).toBe(
      '{"B":2,"a":{"e":4,"z":[{"x":2,"y":1}],"é":3},"b":1}',
    );
  });
});
