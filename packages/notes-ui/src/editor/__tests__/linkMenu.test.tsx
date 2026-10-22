// @vitest-environment jsdom

import { createRef } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { buildNoteHref, buildVideoTimestampHref } from "@loam/shared/notes/noteLinks";

import { stubClipboard } from "../../testing/clipboard";
import type { NoteDocument } from "../../workspace/types";
import { PageTabEditor, type PageTabCommands } from "../PageTabEditor";

beforeAll(() => {
  // jsdom has no layout; floating menus only need some rectangle to anchor to.
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () => Object.assign([], { item: () => null });
  window.matchMedia ??= (query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList;
});

const link = (href: string, text: string) => ({
  type: "paragraph",
  content: [
    { type: "text", text: "See ", styles: {} },
    { type: "link", href, content: [{ type: "text", text, styles: {} }] },
    { type: "text", text: " here.", styles: {} },
  ],
});

const noteWith = (blocks: unknown[], extra: Partial<NoteDocument> = {}): NoteDocument => ({
  id: "note-1",
  title: "Course",
  updatedAt: "2026-01-01T00:00:00.000Z",
  tabs: [{ id: "notes", title: "Notes", kind: "page", position: 0 }],
  blocksByTab: { notes: blocks as NoteDocument["blocksByTab"][string] },
  activeTabId: "notes",
  graphsByTab: {},
  tablesByTab: {},
  ...extra,
});

const renderEditor = async (note: NoteDocument, { readOnly = false } = {}) => {
  const actions = { onChange: vi.fn(), onOpenNote: vi.fn(), onOpenPlace: vi.fn() };
  const commands = createRef<PageTabCommands>();
  const { container } = render(
    <PageTabEditor
      note={note}
      tab={note.tabs[0]!}
      readOnly={readOnly}
      listLinkableNotes={() => []}
      reveal={null}
      commands={commands}
      {...actions}
    />,
  );
  await waitFor(() => expect(container.querySelector(".bn-editor a[href]")).not.toBeNull());
  return { ...actions, commands, container };
};

const openLinkMenu = (container: HTMLElement) =>
  fireEvent.contextMenu(container.querySelector(".bn-editor a[href]")!, {
    clientX: 10,
    clientY: 10,
  });

const menuItems = async (name: string) => {
  const menu = await screen.findByRole("menu", { name });
  return Array.from(menu.querySelectorAll('[role="menuitem"]'), (item) => item.textContent?.trim());
};

const choose = async (name: string) =>
  fireEvent.click(await screen.findByRole("menuitem", { name }));

describe("a link's right-click menu", () => {
  it("opens or copies a note link in a read-only note", async () => {
    const href = buildNoteHref("note-2");
    const { container, onOpenNote } = await renderEditor(noteWith([link(href, "Target")]), {
      readOnly: true,
    });

    openLinkMenu(container);
    expect(await menuItems("Link actions")).toEqual(["Open note", "Copy link"]);
    await choose("Open note");
    await waitFor(() => expect(onOpenNote).toHaveBeenCalledWith("note-2"));

    // Copied, it pastes into a note as the same link.
    const clipboard = stubClipboard();
    openLinkMenu(container);
    await choose("Copy link");
    await waitFor(() => expect(clipboard.written).toHaveLength(1));
    expect(await clipboard.copiedLink()).toEqual({ plainText: href, href, text: "Target" });
  });

  it("opens a web link in the browser", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { container } = await renderEditor(noteWith([link("https://example.com/", "Site")]), {
      readOnly: true,
    });

    openLinkMenu(container);
    expect(await menuItems("Link actions")).toEqual(["Open link", "Copy link"]);
    await choose("Open link");
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://example.com/"));
    open.mockRestore();
  });

  it("plays the note's video from a timestamp, as a click does", async () => {
    const { container, onOpenPlace } = await renderEditor(
      noteWith([link(buildVideoTimestampHref(83), "1:23")], {
        video: { url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", videoId: "aaaaaaaaaaa" },
      }),
      { readOnly: true },
    );

    openLinkMenu(container);
    expect(await menuItems("Link actions")).toEqual(["Play from here"]);
    await choose("Play from here");
    await waitFor(() => expect(onOpenPlace).toHaveBeenCalledWith({ kind: "video", seconds: 83 }));
  });

  it("removes a link but keeps its text while editing", async () => {
    const { container, commands, onChange } = await renderEditor(
      noteWith([link("https://example.com/", "Site")]),
    );

    openLinkMenu(container);
    expect(await menuItems("Link actions")).toEqual(["Open link", "Copy link", "Remove link"]);
    await choose("Remove link");

    await waitFor(() => expect(container.querySelector(".bn-editor a[href]")).toBeNull());
    expect(container.querySelector(".bn-editor")?.textContent).toBe("See Site here.");
    expect(onChange).toHaveBeenCalled();

    act(() => commands.current!.undo());
    expect(container.querySelector(".bn-editor a[href]")?.textContent).toBe("Site");
  });

  it("leaves a right-click on plain text in a read-only note to the native menu", async () => {
    const { container } = await renderEditor(noteWith([link(buildNoteHref("note-2"), "Target")]), {
      readOnly: true,
    });
    const text = container.querySelector('.bn-editor [data-content-type="paragraph"]')!;
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    act(() => {
      text.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
