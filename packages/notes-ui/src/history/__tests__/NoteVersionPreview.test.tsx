// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NoteContent } from "@loam/shared/notes/noteModel";

import { NoteVersionPreview } from "../NoteVersionPreview";

// The app sets the theme on <html> before it renders; the editor follows it.
beforeEach(() => {
  document.documentElement.dataset.theme = "light";
});

afterEach(() => {
  vi.restoreAllMocks();
});

const text = (value: string) => ({ type: "text", text: value, styles: {} });
const link = (href: string, value: string) => ({ type: "link", href, content: [text(value)] });

const version = {
  title: "Trip",
  activeTabId: "text",
  tabs: [
    { id: "text", title: "Notes", kind: "page" },
    { id: "graph", title: "Map", kind: "graph" },
    { id: "table", title: "Costs", kind: "table" },
  ],
  blocksByTab: {
    text: [
      { id: "a", type: "paragraph", content: [text("Pack light.")], children: [] },
      {
        id: "b",
        type: "paragraph",
        content: [
          link("https://example.com/", "the guide"),
          text(" and "),
          link("/notes?noteId=n2", "the packing list"),
        ],
        children: [],
      },
      { id: "c", type: "image", props: { url: "3f1c.png", name: "Beach photo" }, children: [] },
    ],
    graph: [],
    table: [],
  },
  graphsByTab: {
    graph: {
      nodes: [{ id: "n1", title: "Lisbon", position: { x: 0, y: 0 } }],
      edges: [],
    },
  },
  tablesByTab: {
    table: {
      columns: [
        { id: "item", title: "Item", type: "text" },
        { id: "paid", title: "Paid", type: "boolean" },
      ],
      rows: [{ id: "r1", cells: { item: "Train", paid: true } }],
    },
  },
} as unknown as NoteContent;

const section = (name: string) => screen.getByRole("region", { name });

describe("NoteVersionPreview", () => {
  it("shows each tab of the version, read-only", async () => {
    render(<NoteVersionPreview noteId="n1" note={version} />);

    const notes = section("Notes");
    expect(await within(notes).findByText("Pack light.")).toBeTruthy();
    expect(notes.querySelector("[contenteditable='true']")).toBeNull();
    const photo = await within(notes).findByRole("img", { name: "Beach photo" });
    expect(photo.getAttribute("src")).toBe("loam-media://images/3f1c.png");

    expect(within(section("Map")).getByRole("img", { name: "Map" }).textContent).toContain(
      "Lisbon",
    );
    const costs = within(section("Costs")).getByRole("table", { name: "Costs" });
    expect(
      within(costs)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(["Train", "✓"]);
  });

  it("opens web links in the browser and leaves links into notes alone", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<NoteVersionPreview noteId="n1" note={version} />);

    fireEvent.click(await screen.findByText("the guide"));
    expect(open).toHaveBeenCalledWith("https://example.com/");

    open.mockClear();
    const noteLink = screen.getByText("the packing list");
    expect(fireEvent.click(noteLink)).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});
