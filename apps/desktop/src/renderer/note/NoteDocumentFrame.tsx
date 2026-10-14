import { useCallback, useId, type ReactElement, type ReactNode } from "react";
import { MoveDiagonal2Icon, RotateCcwIcon, Undo2Icon } from "lucide-react";

import { ActionMenuContent, ActionMenuItem } from "../action-menu/ActionMenu";
import { formatShortcut } from "../keyboard/shortcuts";
import { ContextMenu, ContextMenuTrigger } from "../ui/ContextMenu";

import { cn } from "../ui/cn";
import { useMarkWhileScrolling } from "./useMarkWhileScrolling";
import page from "./notePage.module.css";
import { CanvasDotBackground } from "../ui/CanvasDotBackground";
import { useNotesPaperSize } from "./useNotesPaperSize";

type NoteDocumentFrameMode = "paper" | "immersive" | "graph";

type PaperSizeActions = ReturnType<typeof useNotesPaperSize>["sizeActions"];

/** A resize handle's right-click menu: undo the last resize, or go back to A4. */
function PaperSizeMenu({
  actions,
  children,
}: {
  actions: PaperSizeActions;
  children: ReactElement;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ActionMenuContent aria-label="Paper size">
        <ActionMenuItem
          icon={<Undo2Icon aria-hidden="true" />}
          shortcut="edit.undo"
          disabled={!actions.canUndo}
          onSelect={actions.undo}
        >
          Undo resize
        </ActionMenuItem>
        <ActionMenuItem
          icon={<RotateCcwIcon aria-hidden="true" />}
          disabled={actions.isDefault}
          onSelect={actions.reset}
        >
          Restore default size
        </ActionMenuItem>
      </ActionMenuContent>
    </ContextMenu>
  );
}

type NoteDocumentFrameProps = {
  mode: NoteDocumentFrameMode;
  /** The note's tabs, on the paper's top edge. */
  tabs?: ReactNode;
  paperClassName?: string;
  resizable?: boolean;
  /** A second column of the paper beside the note, such as its video. */
  side?: ReactNode;
  /** The side column fills the paper; the note stays mounted, hidden. */
  sideFills?: boolean;
  children: ReactNode;
};

export const NoteDocumentFrame = ({
  mode,
  tabs,
  paperClassName,
  resizable = false,
  side,
  sideFills = false,
  children,
}: NoteDocumentFrameProps) => {
  const isGraph = mode === "graph";
  const isPaper = mode === "paper";
  const paperId = useId();
  const resizeHintId = useId();
  const {
    paperRef,
    bindSizeCanvas,
    resizeAxis,
    sizeActions,
    paperStyle,
    widthHandleProps,
    cornerHandleProps,
  } = useNotesPaperSize(isPaper);
  const markWhileScrolling = useMarkWhileScrolling<HTMLDivElement>(!isGraph);
  const bindCanvas = useCallback(
    (canvas: HTMLDivElement | null) => {
      const releaseScrollPaint = markWhileScrolling(canvas);
      const releaseSize = bindSizeCanvas(canvas);
      if (!canvas || !isGraph)
        return () => {
          releaseScrollPaint?.();
          releaseSize?.();
        };
      const measureTop = () => {
        if (canvas.getBoundingClientRect().width === 0) return;
        canvas.style.setProperty(
          "--notes-graph-top",
          `${Math.max(0, canvas.getBoundingClientRect().top)}px`,
        );
      };
      measureTop();
      const observer = new ResizeObserver(measureTop);
      // Header wrapping and retained-tab reveal can move the graph without
      // resizing the viewport. Observe its layout ancestors as well as itself.
      let ancestor: HTMLElement | null = canvas;
      while (ancestor) {
        observer.observe(ancestor);
        ancestor = ancestor.parentElement;
      }
      window.addEventListener("resize", measureTop);
      return () => {
        observer.disconnect();
        window.removeEventListener("resize", measureTop);
        releaseScrollPaint?.();
        releaseSize?.();
      };
    },
    [markWhileScrolling, bindSizeCanvas, isGraph],
  );

  return (
    <div
      ref={bindCanvas}
      data-testid="notes-document-canvas"
      data-notes-document-mode={mode}
      data-paper-resize-axis={resizeAxis ?? undefined}
      style={isPaper ? paperStyle : undefined}
      className={isGraph ? page.graphCanvas : page.canvas}
    >
      {!isGraph ? <CanvasDotBackground style={{ zIndex: -1 }} /> : null}
      <div className={page.sheet}>
        {tabs ? <div className={page.tabs}>{tabs}</div> : null}
        <div
          id={paperId}
          ref={paperRef}
          data-testid="notes-document-paper"
          className={cn(
            isGraph ? page.graphPaper : page.paper,
            paperClassName,
            isGraph && "min-h-0 flex-1",
            side && page.paperWithSide,
          )}
        >
          {side ? (
            <>
              <div className={page.paperMain} style={sideFills ? { display: "none" } : undefined}>
                {children}
              </div>
              {side}
            </>
          ) : (
            children
          )}
          {isPaper && resizable ? (
            <>
              <PaperSizeMenu actions={sizeActions}>
                <div
                  className={page.widthHandle}
                  aria-controls={paperId}
                  aria-describedby={resizeHintId}
                  {...widthHandleProps}
                />
              </PaperSizeMenu>
              <PaperSizeMenu actions={sizeActions}>
                <button
                  type="button"
                  className={page.cornerHandle}
                  aria-controls={paperId}
                  aria-describedby={resizeHintId}
                  {...cornerHandleProps}
                >
                  <MoveDiagonal2Icon size={14} aria-hidden="true" />
                </button>
              </PaperSizeMenu>
              <span id={resizeHintId} className="sr-only">
                Use Left and Right to change width. The corner also supports Up and Down to change
                height. Hold Shift for larger steps. Escape cancels a drag,{" "}
                {formatShortcut("edit.undo")} undoes a resize, and Enter or Home restores A4 size;
                the right-click menu offers both too. The paper grows to fit your note.
              </span>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};
