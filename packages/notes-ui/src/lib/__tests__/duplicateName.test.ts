import { describe, expect, it } from "vitest";

import { incrementDuplicateName } from "../duplicateName";

describe("incrementDuplicateName", () => {
  it("numbers a first copy and counts up from there", () => {
    expect(incrementDuplicateName("Morning routine")).toBe("Morning routine (1)");
    expect(incrementDuplicateName("Morning routine (1)")).toBe("Morning routine (2)");
    expect(incrementDuplicateName("(9)")).toBe("(10)");
    expect(incrementDuplicateName("  ")).toBe("(1)");
  });

  it("keeps fullwidth parentheses and leaves other parentheses alone", () => {
    expect(incrementDuplicateName("メモ（1）")).toBe("メモ（2）");
    expect(incrementDuplicateName("Risk (ES)")).toBe("Risk (ES) (1)");
  });
});
