import { NoteGraphNodeTimestamp } from "./NoteGraphNodeTimestamp";
import {
  Handle,
  NodeResizeControl,
  Position,
  ResizeControlVariant,
  type ControlLinePosition,
  type ControlPosition,
  type NodeProps,
  type OnResize,
  type OnResizeEnd,
} from "@xyflow/react";
import { Input } from "../ui/Input";
import { LinkIcon, LockIcon, ImageIcon } from "lucide-react";
import { memo, type CSSProperties } from "react";

import {
  getNoteGraphNodeSize,
  noteGraphNodeSizeLimits,
} from "@loam/shared/notes/noteGraphGeometry";
import { resolveNoteGraphNodeHex } from "@loam/shared/notes/noteGraphColors";
import type { GraphFlowNode } from "./noteGraphFlowElements";
import { cn } from "../ui/cn";
import { RemoteAwareImage } from "../media/RemoteAwareImage";
import { useImageUrl } from "../media/useImageUrl";

import { useNoteGraphNodeCard, type NoteGraphNodeDraft } from "./useNoteGraphNodeCard";
import { useShiftKeyHeld } from "./useShiftKeyHeld";
import type {
  NoteGraphNode,
  NoteGraphNodeShape,
  NoteGraphNodeSize,
  NoteGraphNodeVariant,
} from "@loam/shared/notes/noteModel";

const nodeColorStyle = (node: Pick<NoteGraphNode, "color" | "colorHex">): CSSProperties =>
  ({ "--node-color": resolveNoteGraphNodeHex(node) }) as CSSProperties;

const noteGraphVariantClasses: Record<NoteGraphNodeVariant, string> = {
  filled:
    "border-(--node-color) bg-[color-mix(in_srgb,var(--node-color)_12%,var(--app-page))] text-(--app-text)",
  outline: "border-(--node-color) bg-(--app-page) text-(--app-text)",
  ghost: "border-dashed border-(--node-color)/60 bg-(--app-page) text-(--app-muted)",
};

const resolveNodeColorClasses = (node: Pick<NoteGraphNode, "shape" | "variant">): string => {
  if ((node.shape ?? "process") === "text") return "text-(--app-text)";
  if (node.shape === "frame") {
    return "border-(--node-color)/70 bg-[color-mix(in_srgb,var(--node-color)_6%,transparent)] text-(--app-text)";
  }
  return noteGraphVariantClasses[node.variant ?? "filled"];
};

const noteGraphHandlePositions = [
  Position.Top,
  Position.Right,
  Position.Bottom,
  Position.Left,
] as const;

const noteGraphHandleClassName =
  "note-graph-handle !size-2.5 !border-2 !border-(--app-page) !bg-(--app-accent) opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 data-[connecting=true]:opacity-100 !cursor-pointer";

// Typing in a node must not drag the node or zoom the canvas.
const inlineFieldClassName = "nodrag nowheel w-full";

const noteGraphResizeHandleClassName = "note-graph-resize-handle";
const noteGraphResizeLineClassName = "note-graph-resize-line";
const noteGraphResizeEdgePositions: ControlLinePosition[] = ["top", "right", "bottom", "left"];
const noteGraphResizeCornerPositions: ControlPosition[] = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];

const resolveShapeClass = (shape: NoteGraphNodeShape) => {
  if (shape === "terminator") return "rounded-full";
  if (shape === "ellipse") return "rounded-[50%]";
  if (shape === "sticky") return "rounded-sm shadow-md";
  if (shape === "text") return "border-transparent bg-transparent shadow-none";
  if (shape === "decision") return "[clip-path:polygon(50%_0%,100%_50%,50%_100%,0%_50%)]";
  if (shape === "image") return "overflow-hidden rounded-md";
  if (shape === "frame") return "rounded-lg border-2";
  return "rounded-md";
};

function NoteGraphNodeImage({
  imageUrl,
  title,
  readOnly,
  onReplace,
}: {
  imageUrl: string;
  title: string;
  readOnly: boolean;
  onReplace: () => void;
}) {
  const { url, isLoading } = useImageUrl(imageUrl);
  return (
    <div className="relative size-full overflow-hidden bg-black/5 dark:bg-white/10">
      {url ? (
        <RemoteAwareImage
          alt={title.trim() || "Node image"}
          className="object-cover"
          draggable={false}
          sizes="240px"
          src={url}
        />
      ) : (
        <span
          aria-label={isLoading ? "Loading image" : "Image unavailable"}
          className={cn("block size-full", isLoading && "animate-pulse bg-current/5")}
          role="img"
        />
      )}
      {!readOnly ? (
        <button
          aria-label={`Replace image on ${title.trim() || "Untitled node"}`}
          className="nodrag nowheel absolute right-1 top-1 z-10 inline-flex min-h-11 min-w-11 items-center justify-center rounded border border-white/40 bg-black/55 px-1.5 text-[10px] font-semibold text-white opacity-0 shadow-sm transition-opacity hover:bg-black/70 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 group-hover:opacity-100 md:min-h-6 md:min-w-6"
          onClick={(event) => {
            event.stopPropagation();
            onReplace();
          }}
          onPointerDown={(event) => event.stopPropagation()}
          type="button"
        >
          <ImageIcon aria-hidden="true" className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function NoteGraphNodeImageWell({
  title,
  readOnly,
  onUpload,
}: {
  title: string;
  readOnly: boolean;
  onUpload: () => void;
}) {
  return (
    <button
      aria-label={`Add image to ${title.trim() || "Untitled node"}`}
      className="nodrag nowheel flex size-full cursor-pointer flex-col items-center justify-center gap-1.5 border-0 bg-transparent text-(--app-muted) transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-(--app-accent)/40 dark:hover:bg-white/10"
      disabled={readOnly}
      onClick={(event) => {
        event.stopPropagation();
        onUpload();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      type="button"
    >
      <ImageIcon aria-hidden="true" className="size-6" />
      <span className="text-[11px] font-medium">Add image</span>
    </button>
  );
}

/** The title field of a card or frame being renamed on the canvas. */
function NoteGraphNodeTitleInput({
  label,
  draft,
  chainOnTab = false,
}: {
  label: string;
  draft: NoteGraphNodeDraft;
  /** Tab adds a connected node, as on cards; frames leave Tab alone. */
  chainOnTab?: boolean;
}) {
  return (
    <Input
      className={inlineFieldClassName}
      aria-label={label}
      autoFocus
      maxLength={120}
      onBlur={draft.commit}
      onChange={(event) => draft.set(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") draft.commit();
        if (event.key === "Escape") draft.cancel();
        if (event.key === "Tab" && chainOnTab) draft.chain(event);
      }}
      value={draft.value}
    />
  );
}

function NoteGraphNodeProcessBody({
  node,
  editing,
  titleDraft,
  detailsVisible,
  onSeek,
}: {
  node: NoteGraphNode;
  editing: boolean;
  titleDraft: NoteGraphNodeDraft;
  detailsVisible: boolean;
  onSeek?: (seconds: number) => void;
}) {
  return (
    <div
      className={cn(
        "flex size-full min-h-0 flex-col justify-center overflow-hidden px-3 py-2.5",
        node.shape === "decision" && "px-10 py-6 text-center",
      )}
    >
      {editing ? (
        <NoteGraphNodeTitleInput label="Node title" draft={titleDraft} chainOnTab />
      ) : (
        <div className="break-words text-[12px] font-semibold leading-4">
          {node.title.trim() || "Untitled node"}
        </div>
      )}
      {detailsVisible && node.notes ? (
        <p className="mt-1.5 line-clamp-[8] whitespace-pre-wrap text-[10.5px] leading-[14px] text-current/80">
          {node.notes}
        </p>
      ) : null}
      {detailsVisible && typeof node.timestampSeconds === "number" ? (
        <NoteGraphNodeTimestamp onSeek={onSeek} seconds={node.timestampSeconds} />
      ) : null}
    </div>
  );
}

function NoteGraphNodeFrameBody({
  node,
  editing,
  editable,
  titleDraft,
  hiddenCount,
  onToggleCollapsed,
}: {
  node: NoteGraphNode;
  editing: boolean;
  editable: boolean;
  titleDraft: NoteGraphNodeDraft;
  hiddenCount: number;
  onToggleCollapsed: () => void;
}) {
  return (
    <div className="flex size-full min-h-0 flex-col overflow-hidden">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5">
        {editing ? (
          <NoteGraphNodeTitleInput label="Frame title" draft={titleDraft} />
        ) : (
          <>
            <span className="truncate text-[12px] font-semibold text-(--app-text)">
              {node.title.trim() || "Group"}
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-1">
              {node.collapsed ? (
                <span className="rounded border border-(--app-border)/60 bg-(--app-page)/85 px-1.5 py-0.5 text-[9px] font-semibold text-(--app-muted)">
                  {hiddenCount} hidden
                </span>
              ) : null}
              {editable ? (
                <button
                  aria-label={node.collapsed ? "Expand frame" : "Collapse frame"}
                  className="nodrag nowheel rounded border border-(--app-border)/60 bg-(--app-page)/85 px-1.5 py-0.5 text-[9px] font-semibold text-(--app-muted) transition-colors hover:text-(--app-text)"
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleCollapsed();
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                  type="button"
                >
                  {node.collapsed ? "Expand" : "Collapse"}
                </button>
              ) : null}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function NoteGraphNodeTextBody({
  node,
  editing,
  textDraft,
}: {
  node: NoteGraphNode;
  editing: boolean;
  textDraft: NoteGraphNodeDraft;
}) {
  return (
    <div className="flex size-full min-h-0 flex-col overflow-hidden px-1.5 py-1">
      {editing ? (
        <textarea
          aria-label="Text content"
          autoFocus
          className="nodrag nowheel size-full min-h-8 w-full flex-1 resize-none rounded border border-current/25 bg-white/85 px-1.5 py-1 text-[12px] leading-[16px] outline-none dark:bg-slate-950/85"
          onBlur={textDraft.commit}
          onChange={(event) => textDraft.set(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") textDraft.cancel();
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) textDraft.commit();
            if (event.key === "Tab") textDraft.chain(event);
          }}
          rows={3}
          value={textDraft.value}
        />
      ) : (
        <div className="whitespace-pre-wrap break-words text-[12px] leading-[16px] text-(--app-text)">
          {node.notes?.trim() || node.title.trim() || "Text"}
        </div>
      )}
    </div>
  );
}

function NoteGraphNodeImageBody({
  node,
  readOnly,
  onRequestImage,
}: {
  node: NoteGraphNode;
  readOnly: boolean;
  onRequestImage: () => void;
}) {
  return (
    <div className="size-full min-h-0 overflow-hidden">
      {node.imageUrl ? (
        <NoteGraphNodeImage
          imageUrl={node.imageUrl}
          onReplace={onRequestImage}
          readOnly={readOnly}
          title={node.title}
        />
      ) : (
        <NoteGraphNodeImageWell onUpload={onRequestImage} readOnly={readOnly} title={node.title} />
      )}
    </div>
  );
}

function NoteGraphNodeResizeHandles({
  keepAspectRatio,
  onResize,
  onResizeEnd,
}: {
  keepAspectRatio: boolean;
  onResize: OnResize;
  onResizeEnd: OnResizeEnd;
}) {
  const limits = {
    keepAspectRatio,
    maxHeight: noteGraphNodeSizeLimits.maxHeight,
    maxWidth: noteGraphNodeSizeLimits.maxWidth,
    minHeight: noteGraphNodeSizeLimits.minHeight,
    minWidth: noteGraphNodeSizeLimits.minWidth,
    onResize,
    onResizeEnd,
  };
  return (
    <>
      {noteGraphResizeEdgePositions.map((position) => (
        <NodeResizeControl
          {...limits}
          className={noteGraphResizeLineClassName}
          key={`resize-line-${position}`}
          position={position}
          variant={ResizeControlVariant.Line}
        />
      ))}
      {noteGraphResizeCornerPositions.map((position) => (
        <NodeResizeControl
          {...limits}
          className={noteGraphResizeHandleClassName}
          key={`resize-handle-${position}`}
          position={position}
        >
          <div
            className="size-full"
            aria-description="Drag to resize. Hold Shift to keep the aspect ratio. Double-click to fit content."
          />
        </NodeResizeControl>
      ))}
    </>
  );
}

function NoteGraphNodeChrome({
  node,
  readOnly,
  onOpenHeadingConnections,
}: {
  node: NoteGraphNode;
  readOnly: boolean;
  onOpenHeadingConnections: () => void;
}) {
  const headingConnectionCount = node.headingBlockIds?.length ?? 0;
  return (
    <>
      {node.locked ? (
        <span
          aria-hidden="true"
          className="absolute left-1 top-1 z-10 inline-flex size-5 items-center justify-center rounded border border-(--app-border)/60 bg-(--app-page)/90 text-(--app-muted)"
          title="Locked"
        >
          <LockIcon className="size-3" />
        </span>
      ) : null}
      {headingConnectionCount > 0 ? (
        <button
          aria-label={`Manage ${headingConnectionCount} heading ${
            headingConnectionCount === 1 ? "connection" : "connections"
          } for ${node.title || "Untitled node"}`}
          className="nodrag nowheel absolute right-1 top-1 z-10 inline-flex min-h-11 min-w-11 items-center justify-center gap-0.5 rounded border border-current/20 bg-white/80 px-1 text-[9px] font-semibold shadow-sm hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/30 dark:bg-slate-950/80 dark:hover:bg-slate-950 md:min-h-6 md:min-w-6"
          onClick={(event) => {
            event.stopPropagation();
            onOpenHeadingConnections();
          }}
          onPointerDown={(event) => event.stopPropagation()}
          type="button"
        >
          <LinkIcon aria-hidden="true" className="size-3" />
          {headingConnectionCount}
        </button>
      ) : null}
      {(["target", "source"] as const).flatMap((type) =>
        noteGraphHandlePositions.map((position) => (
          <Handle
            className={noteGraphHandleClassName}
            id={`${position}-${type}`}
            isConnectable={!readOnly}
            key={`${position}-${type}`}
            position={position}
            type={type}
          />
        )),
      )}
    </>
  );
}

/** What a screen reader announces for a node: its kind, title, colour, size and state. */
const describeNoteGraphNode = (node: NoteGraphNode, { width, height }: NoteGraphNodeSize) => {
  const size = `${width} by ${height} pixels`;
  if (node.shape === "image") {
    return `Image node${node.title.trim() ? `: ${node.title}` : ""}, ${size}`;
  }
  if (node.shape === "frame") {
    return `Frame: ${node.title.trim() || "Group"}, ${size}${node.collapsed ? ", collapsed" : ""}`;
  }
  const locked = node.locked ? ", locked" : "";
  return `${node.shape ?? "process"} node: ${node.title}, ${node.color ?? "blue"}, ${size}${locked}`;
};

function NoteGraphNodeCard({ data: { node }, selected }: NodeProps<GraphFlowNode>) {
  const {
    actions,
    editable,
    editing,
    setEditing,
    titleDraft,
    textDraft,
    cardRef,
    onResize,
    onResizeEnd,
    badgeSize,
  } = useNoteGraphNodeCard(node);
  const shiftHeld = useShiftKeyHeld();
  const shape = node.shape ?? "process";
  const readOnly = Boolean(actions?.readOnly);
  const detailsVisible = actions?.detailsVisible ?? true;
  const requestImage = () => actions?.requestImageUpload(node.id);

  let body;
  switch (shape) {
    case "image":
      body = (
        <NoteGraphNodeImageBody node={node} readOnly={readOnly} onRequestImage={requestImage} />
      );
      break;
    case "frame":
      body = (
        <NoteGraphNodeFrameBody
          node={node}
          editing={editing}
          editable={editable}
          titleDraft={titleDraft}
          hiddenCount={actions?.frameMemberCount(node.id) ?? 0}
          onToggleCollapsed={() => actions?.toggleFrameCollapsed(node.id)}
        />
      );
      break;
    case "text":
      body = <NoteGraphNodeTextBody node={node} editing={editing} textDraft={textDraft} />;
      break;
    default:
      body = (
        <NoteGraphNodeProcessBody
          node={node}
          editing={editing}
          titleDraft={titleDraft}
          detailsVisible={detailsVisible}
          onSeek={actions?.seekVideoTimestamp}
        />
      );
  }

  return (
    <div
      aria-label={describeNoteGraphNode(node, getNoteGraphNodeSize(node))}
      className={cn(
        "group relative size-full border-2 text-[11px] leading-[15px]",
        shape === "frame" ? "" : "shadow-sm",
        shape === "image"
          ? "border-(--app-border) bg-(--app-page-2) text-(--app-text)"
          : resolveNodeColorClasses(node),
        resolveShapeClass(shape),
        shape === "image" && !node.imageUrl && "border-dashed",
        node.locked && "cursor-default",
        selected && "ring-2 ring-inset ring-(--app-text)/30",
      )}
      onDoubleClick={(event) => {
        event.stopPropagation();
        // Text is written where it stands; a card opens its details, where its title is too.
        if (shape === "text" || shape === "frame") {
          if (editable) setEditing(true);
        } else if (shape === "image" && editable && !node.imageUrl) requestImage();
        else actions?.openDetails(node.id);
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        if (
          event.target instanceof Element &&
          event.target.closest(
            'input, textarea, button, [contenteditable=""], [contenteditable="true"]',
          )
        ) {
          return;
        }
        actions?.focusGraphPane();
      }}
      ref={cardRef}
      role="group"
      style={nodeColorStyle(node)}
    >
      {selected && editable && detailsVisible && !(shape === "frame" && node.collapsed) ? (
        <NoteGraphNodeResizeHandles
          keepAspectRatio={shiftHeld}
          onResize={onResize}
          onResizeEnd={onResizeEnd}
        />
      ) : null}
      {badgeSize ? (
        <div
          aria-hidden="true"
          className="nodrag pointer-events-none absolute -bottom-7 right-0 z-20 rounded border border-(--app-border)/60 bg-(--app-page) px-1.5 py-0.5 font-mono text-[10px] font-medium tabular-nums text-(--app-text) shadow-sm"
        >
          {badgeSize.width} × {badgeSize.height}
        </div>
      ) : null}
      {detailsVisible ? (
        <NoteGraphNodeChrome
          node={node}
          readOnly={readOnly}
          onOpenHeadingConnections={() => actions?.openHeadingConnections(node.id)}
        />
      ) : null}
      {body}
    </div>
  );
}

const NoteGraphNodeCardMemo = memo(
  NoteGraphNodeCard,
  (prev, next) =>
    prev.data.node === next.data.node &&
    prev.selected === next.selected &&
    prev.dragging === next.dragging,
);

export const noteGraphNodeTypes = { noteGraph: NoteGraphNodeCardMemo };
