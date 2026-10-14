import { describe, expect, it } from "vitest";

import { compareVectors, DeviceClock, mergeVectors } from "../sync/clock";

describe("device clocks", () => {
  it("keep increasing when the wall clock stalls or goes back", () => {
    let now = 5_000;
    const clock = new DeviceClock("aaaaaaaa", null, () => now);
    const first = clock.next();
    const second = clock.next();
    now = 1_000;
    const third = clock.next();
    expect(first < second && second < third).toBe(true);
  });

  it("issue clocks after any clock observed from another device", () => {
    const clock = new DeviceClock("aaaaaaaa", null, () => 1_000);
    const later = new DeviceClock("bbbbbbbb", null, () => 9_000).next();
    clock.observe(later);
    expect(clock.next() > later).toBe(true);
  });

  it("resume after the last clock persisted", () => {
    const first = new DeviceClock("aaaaaaaa", null, () => 9_000);
    first.next();
    const resumed = new DeviceClock("aaaaaaaa", first.current(), () => 1_000);
    expect(resumed.next() > first.current()).toBe(true);
  });
});

describe("version vectors", () => {
  const a1 = "000000001-0000-aaaaaaaa";
  const a2 = "000000002-0000-aaaaaaaa";
  const b1 = "000000001-0000-bbbbbbbb";

  it("tell newer, older, equal and concurrent versions apart", () => {
    expect(compareVectors({ aaaaaaaa: a2 }, { aaaaaaaa: a1 })).toBe("after");
    expect(compareVectors({ aaaaaaaa: a1 }, { aaaaaaaa: a2 })).toBe("before");
    expect(compareVectors({ aaaaaaaa: a1 }, { aaaaaaaa: a1 })).toBe("equal");
    expect(compareVectors({ aaaaaaaa: a2 }, { aaaaaaaa: a1, bbbbbbbb: b1 })).toBe("concurrent");
    expect(compareVectors({ aaaaaaaa: a2, bbbbbbbb: b1 }, { bbbbbbbb: b1 })).toBe("after");
  });

  it("merge to the newest clock per device", () => {
    expect(mergeVectors({ aaaaaaaa: a2 }, { aaaaaaaa: a1, bbbbbbbb: b1 })).toEqual({
      aaaaaaaa: a2,
      bbbbbbbb: b1,
    });
  });
});
