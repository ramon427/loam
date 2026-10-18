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
      node("Button", { href: "https://teams.microsoft.com/l/meetup-join/1", icon: "video" }, [
        "Join Teams meeting",
      ]),
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
    expect(validateTree(node("Button", { href: "javascript:alert(1)" }, ["x"]))).toBe(
      "Button's href is not a value it takes.",
    );
    expect(validateTree(node("Link", { href: "https://x.test" }, [node("Text")]))).toBe(
      "Only text goes inside this element.",
    );
  });

  it("takes a calendar grid with its events and a popover, and refuses malformed events", () => {
    const event = {
      id: "e1",
      title: "Standup",
      start: "2026-10-19T09:00:00+02:00",
      end: "2026-10-19T09:15:00+02:00",
      allDay: false,
      color: "#039be5",
    };
    const grid = (props: Record<string, unknown>) =>
      node("CalendarGrid", { view: "week", start: "2026-10-19", events: [event], ...props }, [
        node("Input", { autoFocus: true, placeholder: "Add title" }),
      ]);
    expect(
      validateTree(
        grid({
          events: [{ ...event, cancelled: true, readOnly: true }],
          onMove: { __handler: "h1" },
          draft: { start: "2026-10-20", end: "2026-10-21", allDay: true },
          workingHours: { start: 9, end: 17 },
        }),
      ),
    ).toBeNull();
    expect(validateTree(grid({ events: [{ ...event, color: "red" }] }))).toBe(
      "CalendarGrid's events is not a value it takes.",
    );
    expect(validateTree(grid({ events: [{ ...event, start: "tomorrow" }] }))).toBe(
      "CalendarGrid's events is not a value it takes.",
    );
    expect(validateTree(grid({ events: [{ ...event, onClick: "x" }] }))).toBe(
      "CalendarGrid's events is not a value it takes.",
    );
    expect(validateTree(grid({ start: "next week" }))).toBe(
      "CalendarGrid's start is not a value it takes.",
    );
    expect(
      validateTree(node("Swatch", { color: "#d50000", onPress: { __handler: "h" } })),
    ).toBeNull();
    expect(validateTree(node("Swatch", { color: "url(x)" }))).toBe(
      "Swatch's color is not a value it takes.",
    );
  });
});
