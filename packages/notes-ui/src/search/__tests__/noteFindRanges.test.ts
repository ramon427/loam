// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findNoteTextRanges } from "../noteFindRanges";

beforeEach(() => {
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([
    new DOMRect(0, 0, 100, 20),
  ] as unknown as DOMRectList);
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("find in rendered note content", () => {
  it("finds across formatting spans and matches literal punctuation", () => {
    document.body.innerHTML =
      '<div class="bn-inline-content">A <strong>cross</strong><em>format</em> word and a+b.</div>';
    expect(
      findNoteTextRanges(document.body, "crossformat").map((range) => range.toString()),
    ).toEqual(["crossformat"]);
    expect(findNoteTextRanges(document.body, "a+b").map((range) => range.toString())).toEqual([
      "a+b",
    ]);
  });
  it("maps accent-insensitive and Unicode matches back to the original text", () => {
    document.body.innerHTML = '<div class="bn-inline-content">Café CAFÉ 😊 amber</div>';
    expect(findNoteTextRanges(document.body, "cafe").map((range) => range.toString())).toEqual([
      "Café",
      "CAFÉ",
    ]);
    expect(findNoteTextRanges(document.body, "😊").map((range) => range.toString())).toEqual([
      "😊",
    ]);
  });
  it("skips hidden content and does not highlight toolbar controls", () => {
    document.body.innerHTML = '<button>amber</button><div class="bn-inline-content">amber</div>';
    const content = document.querySelector(".bn-inline-content")!;
    vi.spyOn(content, "getClientRects").mockReturnValue([] as unknown as DOMRectList);
    expect(findNoteTextRanges(document.body, "amber")).toEqual([]);
  });
});
