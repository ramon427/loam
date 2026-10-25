// @vitest-environment jsdom

import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  createStore,
  paragraph,
  renderNoteScreen,
  storedText,
  stubLayout,
  textNote,
  pageTabEditor,
} from "./noteViewHarness";
import type { NoteDocument } from "../../workspace/types";

stubLayout();

/** Saves the open note now, as Ctrl+S does, rather than after the pause. */
const save = () => fireEvent.keyDown(document.body, { key: "s", ctrlKey: true });
const tab = (title: string) => screen.getByRole("button", { name: title });

/** The text the page tab on screen shows. */
const editorText = (container: HTMLElement) =>
  container.querySelector(".bn-editor")?.textContent ?? "";

describe("the open note", () => {
  it("saves a new title and typed text", async () => {
    const store = createStore([textNote("note-save", { notes: [paragraph("p1", "Start")] })]);
    const { container } = await renderNoteScreen(store, "note-save");
    fireEvent.change(await screen.findByRole("textbox", { name: "Course" }), {
      target: { value: "Renamed" },
    });
    const editor = await pageTabEditor(container);
    act(() => {
      editor.setTextCursorPosition("p1", "end");
      editor.insertInlineContent(" more");
    });
    save();

    await waitFor(() => expect(store.note("note-save").title).toBe("Renamed"));
    expect(storedText(store.note("note-save"), "notes")).toContain("Start more");
  });

  it("keeps each page tab's text and its undo history across tab switches", async () => {
    const store = createStore([
      textNote("note-tabs", { first: [paragraph("a", "One")], second: [paragraph("b", "Two")] }),
    ]);
    const { container } = await renderNoteScreen(store, "note-tabs");
    const first = await pageTabEditor(container);
    act(() => {
      first.setTextCursorPosition("a", "end");
      first.insertInlineContent(" typed");
    });

    fireEvent.click(tab("second"));
    await waitFor(() => expect(editorText(container)).toBe("Two"));
    fireEvent.click(tab("first"));
    await waitFor(() => expect(editorText(container)).toBe("One typed"));
    fireEvent.click(screen.getByRole("button", { name: "Undo note edit" }));

    await waitFor(() => expect(editorText(container)).toBe("One"));
    save();
    await waitFor(() =>
      expect(storedText(store.note("note-tabs"), "first")).not.toContain("typed"),
    );
  });

  it("adds a table tab that starts with a table and shows it", async () => {
    const store = createStore([textNote("note-add", { notes: [paragraph("p1", "Text")] })]);
    await renderNoteScreen(store, "note-add");
    const addTab = await screen.findByRole("button", { name: "Add tab" });
    fireEvent.pointerDown(addTab, { button: 0, ctrlKey: false });
    fireEvent.click(addTab);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Table tab" }));
    save();

    await waitFor(() => expect(store.note("note-add").tabs).toHaveLength(2));
    const added = store.note("note-add").tabs[1]!;
    expect(added).toMatchObject({ kind: "table", title: "Table" });
    expect(store.note("note-add").activeTabId).toBe(added.id);
    expect(store.note("note-add").tablesByTab?.[added.id]?.columns.length).toBeGreaterThan(0);
  });

  it("opens a linked note when its link is Ctrl-clicked", async () => {
    const store = createStore([
      textNote("note-from", {
        notes: [
          {
            id: "p1",
            type: "paragraph",
            content: [
              {
                type: "link",
                href: "/notes?noteId=note-to",
                content: [{ type: "text", text: "the other note", styles: {} }],
              },
            ],
          },
        ],
      }),
      textNote("note-to", { notes: [paragraph("p2", "Arrived")] }, { title: "Destination" }),
    ]);
    const { container } = await renderNoteScreen(store, "note-from");
    const link = await waitFor(() => {
      const anchor = container.querySelector<HTMLAnchorElement>(".bn-editor a[href]");
      expect(anchor).not.toBeNull();
      return anchor!;
    });
    fireEvent.click(link, { ctrlKey: true });

    await screen.findByRole("heading", { name: "Destination" });
  });

  const timestampParagraph = {
    id: "p1",
    type: "paragraph",
    content: [
      {
        type: "link",
        href: "#note-ref?kind=video-timestamp&seconds=42",
        content: [{ type: "text", text: "0:42", styles: {} }],
      },
      { type: "text", text: " Gradient descent diverges", styles: {} },
    ],
  };
  const firstVideo = { url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", videoId: "aaaaaaaaaaa" };
  const openMenu = (trigger: HTMLElement) => {
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
  };

  it("attaches a YouTube link from the note's empty video column", async () => {
    const store = createStore([textNote("note-add-video", { notes: [paragraph("p1", "Text")] })]);
    await renderNoteScreen(store, "note-add-video");
    fireEvent.click(await screen.findByRole("button", { name: "Add video" }));
    fireEvent.change(screen.getByLabelText("YouTube link"), {
      target: { value: "https://youtu.be/bbbbbbbbbbb?t=90" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Attach video" }));
    save();

    await waitFor(() =>
      expect(store.note("note-add-video").video).toMatchObject({
        videoId: "bbbbbbbbbbb",
        lastWatchedSeconds: 90,
      }),
    );
    screen.getByRole("button", { name: "Hide video" });
  });

  it("lists the note's timestamps beside the video with the text they stand in", async () => {
    const store = createStore([
      textNote("note-listed", { notes: [timestampParagraph] }, { video: firstVideo }),
    ]);
    await renderNoteScreen(store, "note-listed");
    const pane = await screen.findByRole("complementary", { name: "Video" });

    expect(within(pane).getByRole("button", { name: "Seek video to 0:42" }).textContent).toBe(
      "0:42Gradient descent diverges",
    );
  });

  it("changing the video keeps the note's timestamps", async () => {
    const store = createStore([
      textNote("note-video", { notes: [timestampParagraph] }, { video: firstVideo }),
    ]);
    await renderNoteScreen(store, "note-video");
    openMenu(await screen.findByRole("button", { name: "Video options" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Change video…" }));
    fireEvent.change(screen.getByLabelText("YouTube link"), {
      target: { value: "https://www.youtube.com/watch?v=bbbbbbbbbbb" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Change video" }));
    save();

    await waitFor(() => expect(store.note("note-video").video?.videoId).toBe("bbbbbbbbbbb"));
    expect(storedText(store.note("note-video"), "notes")).toContain("video-timestamp");
  });

  it("links the video's current moment at the cursor with the timestamp shortcut", async () => {
    const store = createStore([
      textNote("note-stamp", { notes: [paragraph("p1", "Start")] }, { video: firstVideo }),
    ]);
    const { container } = await renderNoteScreen(store, "note-stamp");
    const editor = await pageTabEditor(container);
    act(() => editor.setTextCursorPosition("p1", "end"));
    fireEvent.keyDown(container.querySelector(".ProseMirror")!, {
      key: "T",
      ctrlKey: true,
      shiftKey: true,
    });
    save();

    await waitFor(() =>
      expect(storedText(store.note("note-stamp"), "notes")).toContain("#note-video?t=0"),
    );
  });

  it("removes the video from its tab's menu", async () => {
    const store = createStore([
      textNote("note-remove", { notes: [timestampParagraph] }, { video: firstVideo }),
    ]);
    await renderNoteScreen(store, "note-remove");
    openMenu(await screen.findByRole("button", { name: "Video options" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove video" }));
    save();

    await waitFor(() => expect(store.note("note-remove").video).toBeUndefined());
  });
});

describe("headings that graph nodes link to", () => {
  const linkedNote = (id: string) =>
    textNote(
      id,
      {
        notes: [
          { id: "h1", type: "heading", props: { level: 1 }, content: "Plan" },
          paragraph("p1", "Details"),
        ],
      },
      {
        tabs: [
          { id: "notes", title: "notes", kind: "page", position: 0 },
          { id: "map", title: "map", kind: "graph", position: 1 },
        ],
        blocksByTab: {
          notes: [
            { id: "h1", type: "heading", props: { level: 1 }, content: "Plan" },
            paragraph("p1", "Details"),
          ],
          map: [],
        } as never,
        graphsByTab: {
          map: {
            enabled: true,
            nodes: [{ id: "n1", title: "Idea", position: { x: 0, y: 0 }, headingBlockIds: ["h1"] }],
            edges: [],
          },
        },
      },
    );
  const linkedHeadings = (note: ReturnType<ReturnType<typeof createStore>["note"]>) =>
    note.graphsByTab?.map?.nodes[0]?.headingBlockIds ?? [];

  it("asks before removing one, unlinks it, and Undo links it again", async () => {
    const store = createStore([linkedNote("note-guard")]);
    const { container } = await renderNoteScreen(store, "note-guard");
    const editor = await pageTabEditor(container);
    act(() => editor.removeBlocks(["h1"]));
    // Held back until confirmed.
    expect(editorText(container)).toContain("Plan");
    fireEvent.click(await screen.findByRole("button", { name: "Delete heading and disconnect 1" }));
    await waitFor(() => expect(editorText(container)).not.toContain("Plan"));
    save();
    await waitFor(() =>
      expect(storedText(store.note("note-guard"), "notes")).not.toContain("Plan"),
    );
    expect(linkedHeadings(store.note("note-guard"))).toEqual([]);

    act(() => {
      editor.undo();
    });
    await waitFor(() => expect(editorText(container)).toContain("Plan"));
    save();
    await waitFor(() => expect(linkedHeadings(store.note("note-guard"))).toEqual(["h1"]));
  });

  it("keeps the heading when the removal is cancelled", async () => {
    const store = createStore([linkedNote("note-guard-cancel")]);
    const { container } = await renderNoteScreen(store, "note-guard-cancel");
    const editor = await pageTabEditor(container);
    act(() => editor.removeBlocks(["h1"]));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    save();
    expect(editorText(container)).toContain("Plan");
    expect(linkedHeadings(store.note("note-guard-cancel"))).toEqual(["h1"]);
  });
});

describe("a change made elsewhere to the open note", () => {
  it("shows in place, keeping the editor's focus and cursor", async () => {
    const store = createStore([
      textNote("note-synced", {
        notes: [paragraph("a", "Block one."), paragraph("b", "Block two.")],
      }),
    ]);
    const { container } = await renderNoteScreen(store, "note-synced");
    const editor = await pageTabEditor(container);
    act(() => {
      editor.focus();
      editor.setTextCursorPosition("b", "end");
    });

    // Another device's editor saves whole blocks; only the first one changed there.
    const [first, second] = structuredClone(editor.document);
    const edited = {
      ...first!,
      content: [{ type: "text", text: "Block one. Remote edit.", styles: {} }],
    };
    act(() =>
      store.changeElsewhere("note-synced", () => ({
        blocksByTab: { notes: [edited, second!] } as NoteDocument["blocksByTab"],
      })),
    );
    const secondBlock = container.querySelector('[data-id="b"]');

    await waitFor(() => expect(editorText(container)).toContain("Block one. Remote edit."));
    expect(await pageTabEditor(container)).toBe(editor);
    expect(document.activeElement?.closest(".ProseMirror")).not.toBeNull();
    expect(editor.getTextCursorPosition().block.id).toBe("b");
    expect(container.querySelector('[data-id="b"]')).toBe(secondBlock);
    act(() => editor.insertInlineContent("!"));
    expect(editorText(container)).toContain("Block two.!");
    expect(store.saves()).toBe(0);
  });
  it("shows in place after this window saved its own edit", async () => {
    const store = createStore([
      textNote("note-saved-then-synced", {
        notes: [paragraph("a", "Block one."), paragraph("b", "Block two.")],
      }),
    ]);
    const { container } = await renderNoteScreen(store, "note-saved-then-synced");
    const editor = await pageTabEditor(container);
    act(() => {
      editor.focus();
      editor.setTextCursorPosition("b", "end");
      editor.insertInlineContent(" Typed here.");
    });
    save();
    await waitFor(() =>
      expect(storedText(store.note("note-saved-then-synced"), "notes")).toContain("Typed here."),
    );

    const [first, second] = structuredClone(editor.document);
    const edited = {
      ...first!,
      content: [{ type: "text", text: "Block one. Remote edit.", styles: {} }],
    };
    act(() =>
      store.changeElsewhere("note-saved-then-synced", () => ({
        blocksByTab: { notes: [edited, second!] } as NoteDocument["blocksByTab"],
      })),
    );

    await waitFor(() => expect(editorText(container)).toContain("Block one. Remote edit."));
    expect(editorText(container)).toContain("Block two. Typed here.");
  });
});

describe("opening a note", () => {
  it("shows the tab an open request names", async () => {
    const store = createStore([
      textNote("note-open", { first: [paragraph("a", "One")], second: [paragraph("b", "Two")] }),
    ]);
    const { container } = await renderNoteScreen(store, "note-open", { tabId: "second" });
    await waitFor(() => expect(editorText(container)).toBe("Two"));
  });
});

describe("switching notes", () => {
  /** Holds `notes.get` for `noteId` until the returned function runs. */
  const holdRead = (store: ReturnType<typeof createStore>, noteId: string) => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const invoke = store.bridge.invoke;
    store.bridge.invoke = (async (method: string, params: Record<string, unknown>) => {
      if (method === "notes.get" && params.noteId === noteId) await gate;
      return invoke(method as never, params as never);
    }) as typeof invoke;
    return release;
  };
  const skeleton = (container: HTMLElement) =>
    container.querySelector("[data-notes-document-skeleton]");

  it("keeps the open note on screen, not a skeleton, while the next one is read", async () => {
    const store = createStore([
      textNote("note-from", { notes: [paragraph("a", "From text")] }),
      textNote("note-to", { notes: [paragraph("b", "To text")] }),
    ]);
    const { container, workspace } = await renderNoteScreen(store, "note-from");
    const fromEditor = await pageTabEditor(container);
    const release = holdRead(store, "note-to");

    act(() => workspace().openNote("note-to"));
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(skeleton(container)).toBeNull();
    expect(editorText(container)).toBe("From text");
    expect(await pageTabEditor(container)).toBe(fromEditor);
    expect(container.querySelector("[data-note-held]")?.hasAttribute("inert")).toBe(true);

    release();
    await waitFor(() => expect(editorText(container)).toBe("To text"));
    expect(container.querySelector("[data-note-held]")).toBeNull();
  });

  it("shows the skeleton when the next note takes a while to read", async () => {
    const store = createStore([
      textNote("note-from", { notes: [paragraph("a", "From text")] }),
      textNote("note-slow", { notes: [paragraph("b", "Slow text")] }),
    ]);
    const { container, workspace } = await renderNoteScreen(store, "note-from");
    const release = holdRead(store, "note-slow");

    act(() => workspace().openNote("note-slow"));
    await waitFor(() => expect(skeleton(container)).not.toBeNull(), { timeout: 2000 });

    release();
    await waitFor(() => expect(editorText(container)).toBe("Slow text"));
  });
});
