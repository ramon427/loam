/* The toolbar that floats over the selected nodes or connector, following pans and zooms. */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useViewport } from "@xyflow/react";
import {
  CopyIcon,
  ImageIcon,
  LinkIcon,
  LockIcon,
  LockOpenIcon,
  PanelRightIcon,
  TextAlignCenterIcon,
  Trash2Icon,
} from "lucide-react";

import { cn } from "../ui/cn";
import { Button } from "../ui/Button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../ui/DropdownMenu";
import {
  noteGraphColorHex,
  noteGraphNodeColors,
  resolveNoteGraphNodeHex,
} from "@loam/shared/notes/noteGraphColors";
import { noteGraphImageNodeDefaultSize } from "@loam/shared/notes/noteGraphGeometry";

import { noteGraphEdgeDirections, noteGraphEdgeTypes } from "./noteGraphConnectors";
import type { NoteGraphAlignMode, NoteGraphDistributeAxis } from "./noteGraphLayout";
import { NoteGraphMenuTrigger } from "./NoteGraphMenuTrigger";
import type { NoteGraphReorder } from "./noteGraphOps";
import {
  noteGraphAlignOptions,
  noteGraphDistributeOptions,
  noteGraphReorderOptions,
  noteGraphShapeOptions,
} from "./noteGraphShapes";
import type {
  NoteGraphEdge,
  NoteGraphNode,
  NoteGraphNodeColor,
} from "@loam/shared/notes/noteModel";
import { clamp } from "../lib/clamp";

/** The selection's outline in flow coordinates: the toolbar sits above it, or below near the top. */
export type NoteGraphToolbarAnchor = { x: number; top: number; bottom: number };

/** Closer than this to the canvas top, the toolbar flips below the selection. */
const flipBelowPx = 56;
const gapPx = 10;
/** The toolbar keeps this far inside the canvas edges. */
const edgePx = 8;

const triggerClass = "h-7 px-2";

const edgeTypeLabel = (type: string) =>
  type === "bezier" ? "Curve" : type[0]!.toUpperCase() + type.slice(1);

function NoteGraphFloatingToolbar({
  anchor,
  children,
}: {
  anchor: NoteGraphToolbarAnchor;
  children: ReactNode;
}) {
  const { x, y, zoom } = useViewport();
  const ref = useRef<HTMLDivElement | null>(null);
  // Its own width and the canvas's, measured after layout, keep it from running off an edge.
  const [widths, setWidths] = useState({ own: 0, canvas: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    const canvas = element?.parentElement;
    if (!element || !canvas) return;
    const measure = () => setWidths({ own: element.offsetWidth, canvas: canvas.clientWidth });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);
  const centre = anchor.x * zoom + x;
  const half = widths.own / 2;
  const left =
    widths.canvas > widths.own + edgePx * 2
      ? clamp(centre, edgePx + half, widths.canvas - edgePx - half)
      : centre;
  const top = anchor.top * zoom + y;
  const below = top < flipBelowPx;
  return (
    <div
      aria-label="Selection actions"
      className={cn(
        "nodrag nowheel absolute z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-md border border-(--app-border)/80 bg-(--app-page)/96 px-1 py-1 shadow-lg backdrop-blur",
        !below && "-translate-y-full",
      )}
      ref={ref}
      role="toolbar"
      style={{
        left,
        top: below ? anchor.bottom * zoom + y + gapPx : top - gapPx,
      }}
    >
      {children}
    </div>
  );
}

const Divider = () => <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-(--app-border)/70" />;

function ColorMenu({
  label,
  currentHex,
  selected,
  disabled,
  onPick,
  onAuto,
}: {
  label: string;
  /** Undefined shows the automatic color. */
  currentHex: string | undefined;
  selected: NoteGraphNodeColor | undefined;
  disabled: boolean;
  onPick: (color: NoteGraphNodeColor) => void;
  /** Offers an "Auto" choice that clears the color. */
  onAuto?: () => void;
}) {
  return (
    <DropdownMenu>
      <NoteGraphMenuTrigger
        aria-label={label}
        className={triggerClass}
        disabled={disabled}
        title={label}
      >
        <span
          aria-hidden="true"
          className={cn(
            "size-3.5 rounded-full border border-(--app-border)",
            !currentHex && "bg-(--app-muted)/40",
          )}
          style={currentHex ? { backgroundColor: currentHex } : undefined}
        />
      </NoteGraphMenuTrigger>
      <DropdownMenuContent align="center" className="min-w-0">
        <div className="grid grid-cols-4 gap-1 p-1">
          {noteGraphNodeColors.map((color) => (
            <DropdownMenuItem
              aria-label={`Color ${color}`}
              className={cn(
                "size-8 justify-center rounded-md p-0",
                selected === color && "ring-2 ring-(--app-text)/30",
              )}
              key={color}
              onSelect={() => onPick(color)}
            >
              <span
                aria-hidden="true"
                className="size-5 rounded-full"
                style={{ backgroundColor: noteGraphColorHex[color] }}
              />
            </DropdownMenuItem>
          ))}
        </div>
        {onAuto ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onAuto}>Auto</DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LockButton({
  locked,
  disabled,
  onToggle,
}: {
  locked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      aria-label={locked ? "Unlock selection" : "Lock selection"}
      aria-pressed={locked}
      disabled={disabled}
      onClick={onToggle}
      size="icon-xs"
      title={locked ? "Unlock" : "Lock"}
      variant="ghost-muted"
    >
      {locked ? <LockIcon className="size-4" /> : <LockOpenIcon className="size-4" />}
    </Button>
  );
}

function DetailsButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Button
      aria-label="Details"
      aria-pressed={open}
      onClick={onToggle}
      size="icon-xs"
      title="Details: notes, headings and more"
      variant={open ? "outline" : "ghost-muted"}
    >
      <PanelRightIcon className="size-4" />
    </Button>
  );
}

function DeleteButton({ title, onDelete }: { title: string; onDelete: () => void }) {
  return (
    <Button
      aria-label="Delete selection"
      onClick={onDelete}
      size="icon-xs"
      title={title}
      variant="ghost-muted"
    >
      <Trash2Icon className="size-4" />
    </Button>
  );
}

/** Quick changes to the selected nodes; anything rarer lives in the details panel. */
export function NoteGraphNodeToolbar({
  anchor,
  nodes,
  readOnly,
  detailsOpen,
  onToggleDetails,
  onPatch,
  onDuplicate,
  onConnect,
  onToggleLock,
  onReorder,
  onAlign,
  onDistribute,
  onDelete,
}: {
  anchor: NoteGraphToolbarAnchor;
  /** The selected nodes; at least one. */
  nodes: readonly NoteGraphNode[];
  readOnly: boolean;
  detailsOpen: boolean;
  onToggleDetails: () => void;
  /** Applies to every selected, unlocked node. */
  onPatch: (patch: Partial<NoteGraphNode>) => void;
  onDuplicate: () => void;
  onConnect: () => void;
  onToggleLock: () => void;
  onReorder: (mode: NoteGraphReorder) => void;
  onAlign: (mode: NoteGraphAlignMode) => void;
  onDistribute: (axis: NoteGraphDistributeAxis) => void;
  onDelete: () => void;
}) {
  const single = nodes.length === 1 ? nodes[0]! : null;
  const details = single ? <DetailsButton open={detailsOpen} onToggle={onToggleDetails} /> : null;
  if (readOnly) {
    return details ? (
      <NoteGraphFloatingToolbar anchor={anchor}>{details}</NoteGraphFloatingToolbar>
    ) : null;
  }

  const anyUnlocked = nodes.some((node) => !node.locked);
  const shapes = new Set(nodes.map((node) => node.shape ?? "process"));
  const sharedShape = shapes.size === 1 ? [...shapes][0]! : null;
  const colors = new Set(nodes.map((node) => resolveNoteGraphNodeHex(node)));
  const sharedHex = colors.size === 1 ? [...colors][0] : undefined;
  const sharedColor =
    sharedHex && nodes.every((node) => !node.colorHex) ? (nodes[0]!.color ?? "blue") : undefined;
  const ShapeIcon =
    noteGraphShapeOptions.find((option) => option.id === sharedShape)?.icon ??
    (sharedShape === "image" ? ImageIcon : null);
  const showColor = sharedShape !== "image";
  const showStyle = nodes.some(
    (node) => !["image", "text", "frame"].includes(node.shape ?? "process"),
  );
  const variants = new Set(nodes.map((node) => node.variant ?? "filled"));
  const sharedVariant = variants.size === 1 ? [...variants][0] : undefined;

  return (
    <NoteGraphFloatingToolbar anchor={anchor}>
      {showColor ? (
        <ColorMenu
          label="Color"
          currentHex={sharedHex}
          selected={sharedColor}
          disabled={!anyUnlocked}
          onPick={(color) => onPatch({ color, colorHex: undefined })}
        />
      ) : null}
      <DropdownMenu>
        <NoteGraphMenuTrigger
          aria-label="Shape"
          className={triggerClass}
          disabled={!anyUnlocked}
          title="Shape"
        >
          {ShapeIcon ? <ShapeIcon className="size-3.5 text-(--app-muted)" /> : null}
          {sharedShape
            ? (noteGraphShapeOptions.find((option) => option.id === sharedShape)?.label ?? "Image")
            : "Mixed"}
        </NoteGraphMenuTrigger>
        <DropdownMenuContent align="center">
          {noteGraphShapeOptions.map((option) => (
            <DropdownMenuCheckboxItem
              checked={sharedShape === option.id}
              key={option.id}
              onSelect={() => onPatch({ shape: option.id, imageUrl: undefined })}
            >
              <option.icon className="size-3.5" />
              {option.label}
            </DropdownMenuCheckboxItem>
          ))}
          {single ? (
            <DropdownMenuCheckboxItem
              checked={sharedShape === "image"}
              onSelect={() =>
                onPatch({
                  shape: "image",
                  size: single.size ?? { ...noteGraphImageNodeDefaultSize },
                  notes: undefined,
                })
              }
            >
              <ImageIcon className="size-3.5" />
              Image
            </DropdownMenuCheckboxItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {showStyle ? (
        <DropdownMenu>
          <NoteGraphMenuTrigger
            aria-label="Style"
            className={triggerClass}
            disabled={!anyUnlocked}
            title="Style"
          >
            {sharedVariant ? sharedVariant[0]!.toUpperCase() + sharedVariant.slice(1) : "Mixed"}
          </NoteGraphMenuTrigger>
          <DropdownMenuContent align="center">
            {(["filled", "outline", "ghost"] as const).map((variant) => (
              <DropdownMenuCheckboxItem
                checked={sharedVariant === variant}
                key={variant}
                onSelect={() => onPatch({ variant })}
              >
                {variant[0]!.toUpperCase() + variant.slice(1)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <Divider />
      {single ? (
        <Button
          aria-label="Connect from selected node"
          onClick={onConnect}
          size="icon-xs"
          title="Connect from this node (C, arrows choose target)"
          variant="ghost-muted"
        >
          <LinkIcon className="size-4" />
        </Button>
      ) : null}
      <Button
        aria-label="Duplicate selection"
        onClick={onDuplicate}
        size="icon-xs"
        title="Duplicate (Ctrl+D; Alt+drag also duplicates)"
        variant="ghost-muted"
      >
        <CopyIcon className="size-4" />
      </Button>
      <LockButton locked={!anyUnlocked} onToggle={onToggleLock} />
      <DropdownMenu>
        <NoteGraphMenuTrigger
          aria-label="Order selection"
          className={triggerClass}
          title="Order (z-stack)"
        >
          Order
        </NoteGraphMenuTrigger>
        <DropdownMenuContent align="center">
          {noteGraphReorderOptions.map((option) => (
            <DropdownMenuItem key={option.id} onSelect={() => onReorder(option.id)}>
              {option.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {nodes.length >= 2 ? (
        <DropdownMenu>
          <NoteGraphMenuTrigger
            aria-label="Align selection"
            className={triggerClass}
            title="Align and distribute"
          >
            <TextAlignCenterIcon className="size-3.5 text-(--app-muted)" />
            Align
          </NoteGraphMenuTrigger>
          <DropdownMenuContent align="center">
            {noteGraphAlignOptions.map((option) => (
              <DropdownMenuItem key={option.id} onSelect={() => onAlign(option.id)}>
                {option.label}
              </DropdownMenuItem>
            ))}
            {nodes.length >= 3 ? (
              <>
                <DropdownMenuSeparator />
                {noteGraphDistributeOptions.map((option) => (
                  <DropdownMenuItem key={option.id} onSelect={() => onDistribute(option.id)}>
                    {option.label}
                  </DropdownMenuItem>
                ))}
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <Divider />
      {details}
      <DeleteButton title="Delete (Backspace)" onDelete={onDelete} />
    </NoteGraphFloatingToolbar>
  );
}

/** Quick changes to the selected connector. */
export function NoteGraphEdgeToolbar({
  anchor,
  edge,
  readOnly,
  detailsOpen,
  onToggleDetails,
  onChange,
  onDelete,
}: {
  anchor: NoteGraphToolbarAnchor;
  edge: NoteGraphEdge;
  readOnly: boolean;
  detailsOpen: boolean;
  onToggleDetails: () => void;
  onChange: (patch: Partial<NoteGraphEdge>) => void;
  onDelete: () => void;
}) {
  const details = <DetailsButton open={detailsOpen} onToggle={onToggleDetails} />;
  if (readOnly)
    return <NoteGraphFloatingToolbar anchor={anchor}>{details}</NoteGraphFloatingToolbar>;
  const locked = Boolean(edge.locked);
  const type = edge.type ?? "smoothstep";
  const direction = edge.direction ?? "end";
  return (
    <NoteGraphFloatingToolbar anchor={anchor}>
      <ColorMenu
        label="Connector color"
        currentHex={edge.color ? noteGraphColorHex[edge.color] : undefined}
        selected={edge.color}
        disabled={locked}
        onPick={(color) => onChange({ color })}
        onAuto={() => onChange({ color: undefined })}
      />
      <DropdownMenu>
        <NoteGraphMenuTrigger
          aria-label="Connector path"
          className={triggerClass}
          disabled={locked}
          title="Path"
        >
          {edgeTypeLabel(type)}
        </NoteGraphMenuTrigger>
        <DropdownMenuContent align="center">
          {noteGraphEdgeTypes.map((option) => (
            <DropdownMenuCheckboxItem
              checked={type === option}
              key={option}
              onSelect={() => onChange({ type: option })}
            >
              {edgeTypeLabel(option)}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <NoteGraphMenuTrigger
          aria-label="Connector arrows"
          className={triggerClass}
          disabled={locked}
          title="Arrows"
        >
          {noteGraphEdgeDirections.find((option) => option.id === direction)?.label}
        </NoteGraphMenuTrigger>
        <DropdownMenuContent align="center">
          {noteGraphEdgeDirections.map((option) => (
            <DropdownMenuCheckboxItem
              checked={direction === option.id}
              key={option.id}
              onSelect={() => onChange({ direction: option.id })}
            >
              {option.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Divider />
      <LockButton locked={locked} onToggle={() => onChange({ locked: !locked })} />
      {details}
      <DeleteButton title="Delete connector (Backspace)" onDelete={onDelete} />
    </NoteGraphFloatingToolbar>
  );
}
