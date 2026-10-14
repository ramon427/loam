// @vitest-environment jsdom

import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import { history, undo, redo } from "@tiptap/pm/history";
import { expect, it } from "vitest";
import { createNoteHeadingDecorations } from "../noteHeadingDecoration";

it("preserves connected heading badges through native delete, undo, redraw, and redo", async () => {
  const schema = new Schema({
    nodes: {
      doc: { content: "blockContainer+" },
      blockContainer: {
        content: "heading | paragraph",
        attrs: { id: { default: null } },
        toDOM: (node) => ["div", { "data-id": node.attrs.id }, 0],
      },
      heading: { content: "text*", toDOM: () => ["h2", 0] },
      paragraph: { content: "text*", toDOM: () => ["p", 0] },
      text: {},
    },
  });
  const heading = schema.node(
    "blockContainer",
    { id: "heading-1" },
    schema.node("heading", null, schema.text("Setup")),
  );
  const paragraph = schema.node("blockContainer", { id: "paragraph-1" }, schema.node("paragraph"));
  const doc = schema.node("doc", null, [heading, paragraph]);
  const options = [
    {
      headingBlockId: "heading-1",
      tabId: "text-1",
      tabTitle: "Notes",
      title: "Setup",
      level: 2 as const,
      isToggleable: false,
      connectionCount: 2,
    },
  ];
  const host = document.createElement("div");
  document.body.append(host);
  const view = new EditorView(host, {
    state: EditorState.create({ schema, doc, plugins: [history()] }),
    decorations: (state) => createNoteHeadingDecorations(state, options, "text-1"),
  });
  try {
    expect(host.querySelector("h2")?.getAttribute("data-note-heading-connection-count")).toBe("2");
    view.dispatch(view.state.tr.delete(0, heading.nodeSize));
    expect(host.querySelector("h2")).toBeNull();
    expect(undo(view.state, view.dispatch)).toBe(true);
    // Flush DOM mutation handling and force another view redraw, which removed
    // the old imperative attributes after history restored the heading.
    await new Promise((resolve) => setTimeout(resolve, 0));
    view.updateState(view.state);
    expect(host.querySelector("h2")?.getAttribute("aria-label")).toBe("Setup, 2 connections");
    expect(
      host
        .querySelector('[data-id="heading-1"]')
        ?.getAttribute("data-note-heading-connection-count"),
    ).toBe("2");
    expect(redo(view.state, view.dispatch)).toBe(true);
    expect(host.querySelector("h2")).toBeNull();
  } finally {
    view.destroy();
    host.remove();
  }
});
