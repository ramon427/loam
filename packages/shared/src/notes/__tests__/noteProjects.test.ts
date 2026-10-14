import { describe, expect, it } from "vitest";

import { readNoteProjectIcon } from "../noteProjects";

describe("readNoteProjectIcon", () => {
  it("keeps one emoji, including joined ones, flags and keycaps", () => {
    for (const emoji of ["🚀", "👩🏽‍💻", "🇳🇱", "1️⃣", "❤️"])
      expect(readNoteProjectIcon({ kind: "emoji", value: emoji })).toEqual({
        kind: "emoji",
        value: emoji,
      });
  });

  it("drops text, digits and more than one emoji", () => {
    for (const value of ["a", "12", "#", "🚀🚀", "🚀 ", "", 7])
      expect(readNoteProjectIcon({ kind: "emoji", value })).toBeUndefined();
  });

  it("keeps a known line icon and its palette color, and drops unknown ones", () => {
    expect(readNoteProjectIcon({ kind: "symbol", value: "rocket", color: "blue" })).toEqual({
      kind: "symbol",
      value: "rocket",
      color: "blue",
    });
    expect(readNoteProjectIcon({ kind: "symbol", value: "rocket", color: "teal" })).toEqual({
      kind: "symbol",
      value: "rocket",
    });
    expect(readNoteProjectIcon({ kind: "symbol", value: "spaceship" })).toBeUndefined();
    expect(readNoteProjectIcon({ kind: "image", value: "rocket" })).toBeUndefined();
    expect(readNoteProjectIcon(null)).toBeUndefined();
  });
});
