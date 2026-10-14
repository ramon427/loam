import { describe, expect, it } from "vitest";

import { buildVideoTimestampHref } from "@loam/shared/notes/noteLinks";

import { resolveVideoTimestampLinkForKey } from "../noteVideoTimestampEditing";

describe("noteVideoTimestampEditing", () => {
  const href = buildVideoTimestampHref(83);
  const link = { from: 10, to: 14, href };
  const getLinkAt = (pos: number) => (pos >= link.from && pos < link.to ? link : undefined);

  it.each([
    ["Backspace with the caret inside deletes it", "Backspace", 12, 12, true],
    ["Delete with the caret inside deletes it", "Delete", 12, 12, true],
    ["Backspace just after deletes it", "Backspace", link.to, link.to, true],
    ["Delete just after ignores it", "Delete", link.to, link.to, false],
    ["Delete just before deletes it", "Delete", link.from, link.from, true],
    ["Backspace just before ignores it", "Backspace", link.from, link.from, false],
    ["a partial selection deletes it", "Backspace", 11, 13, true],
    ["a selection past both ends ignores it", "Backspace", 8, 16, false],
  ] as const)("%s", (_label, key, selectionFrom, selectionTo, hit) => {
    expect(resolveVideoTimestampLinkForKey({ key, selectionFrom, selectionTo, getLinkAt })).toEqual(
      hit ? link : null,
    );
  });

  it("leaves links that aren't timestamps to normal editing", () => {
    const web = { from: 10, to: 14, href: "https://example.com" };
    expect(
      resolveVideoTimestampLinkForKey({
        key: "Backspace",
        selectionFrom: 12,
        selectionTo: 12,
        getLinkAt: () => web,
      }),
    ).toBeNull();
  });
});
