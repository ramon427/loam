import { createExtension, type BlockNoteEditor } from "@blocknote/core";
import type { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

import "./hoverPreview.css";

type ColorStyle = "textColor" | "backgroundColor";

/**
 * What a hovered menu control would do if clicked. Previews are drawn as
 * decorations, so hovering never edits the note: no undo step, no save, and a
 * selection's existing mixed colors stay as they are.
 */
export type HoverPreview =
  /** A text or highlight color for the selected text. */
  | { kind: ColorStyle; color: string }
  /** A text alignment for every block the selection touches. */
  | { kind: "alignment"; alignment: string }
  /** A block's text or background color, from the side menu. */
  | { kind: "blockColor"; blockId: string; style: ColorStyle; color: string };

type HoverPreviewState = { preview: HoverPreview | null; decorations: DecorationSet };

const hoverPreviewKey = new PluginKey<HoverPreviewState>("hoverPreview");
const emptyState: HoverPreviewState = { preview: null, decorations: DecorationSet.empty };

const colorAttribute = { textColor: "data-text-color", backgroundColor: "data-background-color" };

const inlineColorAttrs = (style: ColorStyle, color: string) => {
  if (color !== "default") return { [colorAttribute[style]]: color };
  // A preview span sits inside any existing color mark, so "default" must paint over it.
  return style === "textColor"
    ? { style: "color: var(--bn-colors-editor-text)" }
    : { style: "background-color: var(--app-surface)" };
};

/** The block-content nodes (paragraph, heading, ...) the selection touches. */
const selectedBlockContents = (state: EditorState) => {
  const { from, to } = state.selection;
  const contents: { node: Node; pos: number }[] = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.spec.group !== "blockContent") return true;
    contents.push({ node, pos });
    return false;
  });
  return contents;
};

const findBlockContainer = (state: EditorState, blockId: string) => {
  let found: { node: Node; pos: number } | null = null;
  state.doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === "blockContainer" && node.attrs.id === blockId) found = { node, pos };
    return true;
  });
  return found as { node: Node; pos: number } | null;
};

const previewDecorations = (state: EditorState, preview: HoverPreview): Decoration[] => {
  switch (preview.kind) {
    case "textColor":
    case "backgroundColor": {
      const { from, to, empty } = state.selection;
      return empty
        ? []
        : [Decoration.inline(from, to, inlineColorAttrs(preview.kind, preview.color))];
    }
    case "alignment": {
      // BlockNote sets alignment with `!important`, so the preview needs it too.
      const style = `text-align: ${preview.alignment} !important; justify-content: ${
        { center: "center", right: "flex-end" }[preview.alignment] ?? "flex-start"
      } !important`;
      return selectedBlockContents(state)
        .filter(({ node }) => "textAlignment" in node.attrs)
        .map(({ node, pos }) => Decoration.node(pos, pos + node.nodeSize, { style }));
    }
    case "blockColor": {
      const block = findBlockContainer(state, preview.blockId);
      if (!block) return [];
      // The attributes go on `.bn-block-outer`, which BlockNote never colors itself;
      // hoverPreview.css hides the block's own color underneath while previewing.
      const attrs: Record<string, string> = { "data-loam-color-preview": preview.style };
      if (preview.color !== "default") attrs[colorAttribute[preview.style]] = preview.color;
      return [Decoration.node(block.pos, block.pos + block.node.nodeSize, attrs)];
    }
  }
};

export const hoverPreviewExtension = createExtension({
  key: "hoverPreview",
  prosemirrorPlugins: [
    new Plugin<HoverPreviewState>({
      key: hoverPreviewKey,
      state: {
        init: () => emptyState,
        apply(tr, value, _oldState, state) {
          const preview: HoverPreview | null | undefined = tr.getMeta(hoverPreviewKey);
          if (preview === undefined) {
            // An edit or a new selection makes the hovered choice stale.
            return tr.docChanged || tr.selectionSet ? emptyState : value;
          }
          if (!preview) return emptyState;
          return {
            preview,
            decorations: DecorationSet.create(state.doc, previewDecorations(state, preview)),
          };
        },
      },
      props: { decorations: (state) => hoverPreviewKey.getState(state)?.decorations },
    }),
  ],
});

type PreviewEditor = Pick<BlockNoteEditor, "prosemirrorView">;

const liveView = (editor: PreviewEditor) => {
  const view = editor.prosemirrorView;
  return view && !view.isDestroyed ? view : null;
};

const setPreview = (view: EditorView, preview: HoverPreview | null) =>
  view.dispatch(view.state.tr.setMeta(hoverPreviewKey, preview).setMeta("addToHistory", false));

const currentPreview = (view: EditorView) => hoverPreviewKey.getState(view.state)?.preview ?? null;

/** Shows the preview of a hovered menu control, replacing any other. */
export const showHoverPreview = (editor: PreviewEditor, preview: HoverPreview) => {
  const view = liveView(editor);
  if (view && JSON.stringify(currentPreview(view)) !== JSON.stringify(preview)) {
    setPreview(view, preview);
  }
};

/**
 * Clears the preview if it is one of `kinds`. Each menu clears only its own
 * kinds, so one closing (the side menu hides as the pointer heads for the
 * toolbar) can't wipe another's preview.
 */
export const clearHoverPreview = (
  editor: PreviewEditor,
  kinds: readonly HoverPreview["kind"][],
) => {
  const view = liveView(editor);
  const current = view ? currentPreview(view) : null;
  if (view && current && kinds.includes(current.kind)) setPreview(view, null);
};

/** The preview a hovered BlockNote control stands for, read from its `data-test` name. */
export const readHoverPreviewControl = (target: EventTarget) => {
  const name =
    target instanceof Element ? target.closest("[data-test]")?.getAttribute("data-test") : null;
  if (!name) return null;
  const alignment = /^alignText(Left|Center|Right|Justify)$/.exec(name);
  if (alignment) return { kind: "alignment", alignment: alignment[1]!.toLowerCase() } as const;
  const color = /^(text|background)-color-(.+)$/.exec(name);
  if (color) {
    const style: ColorStyle = color[1] === "text" ? "textColor" : "backgroundColor";
    return { kind: "color", style, color: color[2]! } as const;
  }
  return null;
};
