import { describe, expect, it } from "vitest";

import { handlerIds, validateTree } from "../pluginElementTree";

const node = (type: string, props: Record<string, unknown> = {}, children: unknown[] = []) => ({
  type,
  props,
  children,
});

describe("validateTree", () => {
  it("takes grids, pressable boxes, date fields and links", () => {
    const tree = node("Box", { columns: 7, gap: 0 }, [
      node("Box", { onPress: { __handler: "h1" }, label: "October 14, 2 events" }, [
        node("Text", {}, ["14"]),
      ]),
      node("Input", { type: "date", value: "2026-10-14", onChange: { __handler: "h2" } }),
      node("Input", { clearOnSubmit: true, onSubmit: { __handler: "h3" } }),
      node("Link", { href: "https://meet.google.com/abc" }, ["Join"]),
      node("Icon", { name: "chevron-left" }),
    ]);
    expect(validateTree(tree)).toBeNull();
    expect(handlerIds(tree)).toEqual(["h1", "h2", "h3"]);
  });

  it("refuses values out of range and links that aren't web or mail addresses", () => {
    expect(validateTree(node("Box", { columns: 8 }))).toBe(
      "Box's columns is not a value it takes.",
    );
    expect(validateTree(node("Input", { type: "password" }))).toBe(
      "Input's type is not a value it takes.",
    );
    expect(validateTree(node("Link", { href: "javascript:alert(1)" }, ["x"]))).toBe(
      "Link's href is not a value it takes.",
    );
    expect(validateTree(node("Link", { href: "file:///etc/passwd" }, ["x"]))).toBe(
      "Link's href is not a value it takes.",
    );
    expect(validateTree(node("Link", { href: "https://x.test" }, [node("Text")]))).toBe(
      "Only text goes inside this element.",
    );
  });
});
