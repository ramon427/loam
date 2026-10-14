import { createExtension } from "@blocknote/core";
import type { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

/**
 * Resizing columns by dragging the gap between two of them. The pointer
 * resizes from this far inside either column's facing edge, and anywhere in
 * the gap; the editor's styles pad that edge so text stays out of it.
 */
const RESIZE_EDGE = 20;
/** No column gets narrower than this while resizing. */
const MIN_COLUMN_WIDTH = 64;

/** Two neighbouring columns, by the position before the left one. */
type Boundary = { leftPos: number };

type Drag = Boundary & { widths: [number, number] };

type ResizeState = { hover: Boundary | null; drag: Drag | null };

const resizeKey = new PluginKey<ResizeState>("columnResize");

const IDLE: ResizeState = { hover: null, drag: null };

const columnsAt = (doc: Node, leftPos: number) => {
  const left = doc.nodeAt(leftPos);
  const rightPos = leftPos + (left?.nodeSize ?? 0);
  const right = doc.nodeAt(rightPos);
  if (left?.type.name !== "column" || right?.type.name !== "column") return null;
  return { left, right, rightPos };
};

const widthOf = (column: Node) => {
  const width = column.attrs["width"] as unknown;
  return typeof width === "number" && width > 0 ? width : 1;
};

/** The two columns whose gap the pointer is on, with their elements. */
const boundaryAt = (view: EditorView, event: MouseEvent) => {
  if (!(event.target instanceof Element)) return null;
  const listElement = event.target.closest(".bn-block-column-list");
  if (!listElement || !view.dom.contains(listElement)) return null;
  const columnElements = [...listElement.children].filter((child) =>
    child.classList.contains("bn-block-column"),
  );
  for (let index = 0; index < columnElements.length - 1; index += 1) {
    const leftElement = columnElements[index]!;
    const rightElement = columnElements[index + 1]!;
    const left = leftElement.getBoundingClientRect();
    const right = rightElement.getBoundingClientRect();
    // Narrow windows stack the columns; there's nothing to resize then.
    if (right.left < left.right - 1) return null;
    const inGap =
      event.clientX >= left.right - RESIZE_EDGE && event.clientX <= right.left + RESIZE_EDGE;
    if (!inGap || event.clientY < left.top || event.clientY > left.bottom) continue;
    const listPos = view.posAtDOM(listElement, 0) - 1;
    const list = listPos >= 0 ? view.state.doc.nodeAt(listPos) : null;
    if (list?.type.name !== "columnList" || index + 1 >= list.childCount) return null;
    const leftPos = view.state.doc.resolve(listPos + 1).posAtIndex(index);
    return { leftPos, leftElement, rightElement };
  }
  return null;
};

const setResizeState = (view: EditorView, next: ResizeState) =>
  view.dispatch(view.state.tr.setMeta(resizeKey, next));

const sameBoundary = (a: Boundary | null, b: Boundary | null) => a?.leftPos === b?.leftPos;

/**
 * Follows the pointer from a press on a gap until it's released, showing the
 * new widths as it moves and saving them, as one undo step, on release.
 */
const startDrag = (view: EditorView, event: MouseEvent) => {
  const boundary = boundaryAt(view, event);
  const columns = boundary && columnsAt(view.state.doc, boundary.leftPos);
  if (!boundary || !columns) return false;
  event.preventDefault();

  const startX = event.clientX;
  const leftPixels = boundary.leftElement.getBoundingClientRect().width;
  const pixels = leftPixels + boundary.rightElement.getBoundingClientRect().width;
  const total = widthOf(columns.left) + widthOf(columns.right);
  const min = Math.min(MIN_COLUMN_WIDTH, pixels / 2);
  const widthsAt = (clientX: number): [number, number] => {
    const left = Math.min(Math.max(leftPixels + clientX - startX, min), pixels - min);
    const leftWidth = Math.round(((total * left) / pixels) * 1000) / 1000;
    return [leftWidth, Math.round((total - leftWidth) * 1000) / 1000];
  };
  const { leftPos } = boundary;
  let widths: [number, number] = [widthOf(columns.left), widthOf(columns.right)];
  setResizeState(view, { hover: { leftPos }, drag: { leftPos, widths } });

  const onMove = (move: MouseEvent) => {
    widths = widthsAt(move.clientX);
    setResizeState(view, { hover: { leftPos }, drag: { leftPos, widths } });
  };
  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    const { tr } = view.state;
    tr.setMeta(resizeKey, IDLE);
    const current = columnsAt(tr.doc, leftPos);
    const changed =
      current && (widths[0] !== widthOf(current.left) || widths[1] !== widthOf(current.right));
    if (current && changed) {
      tr.setNodeAttribute(leftPos, "width", widths[0]);
      tr.setNodeAttribute(current.rightPos, "width", widths[1]);
    }
    view.dispatch(tr);
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  return true;
};

/**
 * While resizing, a column's width shows through a custom property that the
 * editor's styles apply over its own flex-grow. Setting flex-grow itself would
 * lose the column's width when the decoration goes, as ProseMirror removes the
 * style properties a decoration set.
 */
const widthAttrs = (width: number) => ({
  "data-column-resize-width": "",
  style: `--column-resize-width: ${width};`,
});

const decorations = (state: EditorState) => {
  const { hover, drag } = resizeKey.getState(state) ?? IDLE;
  const boundary = drag ?? hover;
  const columns = boundary && columnsAt(state.doc, boundary.leftPos);
  if (!boundary || !columns) return DecorationSet.empty;
  const { leftPos } = boundary;
  const { left, right, rightPos } = columns;
  const found = [
    Decoration.node(leftPos, leftPos + left.nodeSize, {
      "data-column-resize": "",
      ...(drag ? widthAttrs(drag.widths[0]) : {}),
    }),
  ];
  if (drag) {
    found.push(Decoration.node(rightPos, rightPos + right.nodeSize, widthAttrs(drag.widths[1])));
  }
  return DecorationSet.create(state.doc, found);
};

const columnResizePlugin = new Plugin<ResizeState>({
  key: resizeKey,
  state: {
    init: () => IDLE,
    apply: (tr, value) => {
      const next = tr.getMeta(resizeKey) as ResizeState | undefined;
      if (next) return next;
      // An edit moves the columns; the next pointer move finds them again.
      return tr.docChanged && !value.drag ? IDLE : value;
    },
  },
  props: {
    decorations,
    // Marks the column left of the gap being pointed at or dragged, for the
    // editor's styles to show the cue and the resize cursor.
    attributes: (state): Record<string, string> => {
      const { hover, drag } = resizeKey.getState(state) ?? IDLE;
      return drag || hover ? { "data-column-resize": drag ? "drag" : "hover" } : {};
    },
    handleDOMEvents: {
      mousemove: (view, event) => {
        const state = resizeKey.getState(view.state) ?? IDLE;
        if (state.drag) return false;
        const found = view.editable ? boundaryAt(view, event) : null;
        const hover = found && { leftPos: found.leftPos };
        if (!sameBoundary(hover, state.hover)) setResizeState(view, { hover, drag: null });
        return false;
      },
      mouseleave: (view) => {
        const state = resizeKey.getState(view.state) ?? IDLE;
        if (state.hover && !state.drag) setResizeState(view, IDLE);
        return false;
      },
      mousedown: (view, event) =>
        view.editable && event.button === 0 ? startDrag(view, event) : false,
    },
  },
});

/** Lets the gap between two columns be dragged to share their width differently. */
export const columnResizeExtension = createExtension({
  key: "columnResize",
  prosemirrorPlugins: [columnResizePlugin],
});
