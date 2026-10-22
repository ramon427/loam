import type { EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { NoteHeadingConnectionOption } from "./noteHeadingConnections";

export const createNoteHeadingDecorations = (
  state: EditorState,
  headingOptions: readonly NoteHeadingConnectionOption[],
  activeTabId: string,
) => {
  const headings = new Map(
    headingOptions
      .filter((heading) => heading.tabId === activeTabId && heading.connectionCount > 0)
      .map((heading) => [heading.headingBlockId, heading]),
  );
  const decorations: Decoration[] = [];
  state.doc.descendants((node, position) => {
    if (node.type.name !== "blockContainer") return;
    const heading = headings.get(node.attrs.id);
    const content = node.firstChild;
    if (!heading || content?.type.name !== "heading") return;
    const attributes = { "data-note-heading-connection-count": String(heading.connectionCount) };
    decorations.push(
      Decoration.node(position, position + node.nodeSize, attributes),
      Decoration.node(position + 1, position + 1 + content.nodeSize, {
        ...attributes,
        "aria-label": `${heading.title}, ${heading.connectionCount} ${heading.connectionCount === 1 ? "connection" : "connections"}`,
      }),
    );
  });
  return DecorationSet.create(state.doc, decorations);
};
