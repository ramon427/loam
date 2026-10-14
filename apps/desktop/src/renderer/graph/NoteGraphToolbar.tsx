import {
  Undo2Icon,
  Redo2Icon,
  ClockIcon,
  DownloadIcon,
  FocusIcon,
  LayoutGridIcon,
  ListIcon,
  ImageIcon,
  EllipsisIcon,
  PlayIcon,
  SearchIcon,
  LayoutTemplateIcon,
  UploadIcon,
} from "lucide-react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { useState, type RefObject } from "react";

import { cn } from "../ui/cn";
import { Button } from "../ui/Button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "../ui/DropdownMenu";
import { PopoverContent } from "../ui/Popover";

import type { NoteGraphViewPreferences } from "./noteGraph";
import type { NoteGraphImportFormat } from "./noteGraphImport";
import {
  computeNoteGraphGridLayout,
  computeNoteGraphRadialLayout,
  computeNoteGraphTidyLayout,
  computeNoteGraphVerticalLayout,
  repairNoteGraphOverlaps,
  type NoteGraphPositions,
} from "./noteGraphLayout";
import { NoteGraphMenuTrigger } from "./NoteGraphMenuTrigger";
import { noteGraphShapeDragType } from "./noteGraphPaneDrop";
import { noteGraphShapeOptions } from "./noteGraphShapes";
import { noteGraphTemplates } from "./noteGraphTemplates";
import type { NoteGraph, NoteGraphNodeShape } from "@loam/shared/notes/noteModel";

type NoteGraphLayoutCommands = {
  getGraph: () => NoteGraph;
  selectionCount: number;
  timestampedNodeCount: number;
  applyLayout: (positions: NoteGraphPositions, label: string) => void;
  tidySelection: () => void;
  applyTimelineLayout: () => void;
  connectPlaybackOrder: () => void;
  colorByCluster: () => void;
};

type NoteGraphExportCommands = {
  copyPng: () => void;
  downloadPng: () => void;
  downloadSvg: () => void;
  downloadJsonCanvas: () => void;
};

const gridLabels: Record<NoteGraphViewPreferences["grid"], string> = {
  dots: "Dots",
  lines: "Lines",
  off: "No grid",
};

const themeLabels: Record<NoteGraphViewPreferences["theme"], string> = {
  default: "Default",
  blueprint: "Blueprint",
  warm: "Warm",
};

function NoteGraphLayoutMenu({ layout }: { layout: NoteGraphLayoutCommands }) {
  const { getGraph, applyLayout } = layout;
  return (
    <DropdownMenu>
      <NoteGraphMenuTrigger>
        <LayoutGridIcon className="size-3.5 text-(--app-muted)" />
        Layout
      </NoteGraphMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={() => applyLayout(computeNoteGraphTidyLayout(getGraph()), "Tidied")}
        >
          Tidy (left to right)
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => applyLayout(computeNoteGraphVerticalLayout(getGraph()), "Tidied")}
        >
          Tidy (top to bottom)
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => applyLayout(computeNoteGraphGridLayout(getGraph().nodes), "Grid layout")}
        >
          Grid
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => applyLayout(computeNoteGraphRadialLayout(getGraph()), "Radial layout")}
        >
          Radial
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={layout.timestampedNodeCount < 2}
          onSelect={layout.applyTimelineLayout}
        >
          Timeline (video order)
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={layout.selectionCount < 2} onSelect={layout.tidySelection}>
          Tidy selection
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            applyLayout(repairNoteGraphOverlaps(getGraph().nodes), "Repaired overlaps")
          }
        >
          Repair overlaps
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={layout.timestampedNodeCount < 2}
          onSelect={layout.connectPlaybackOrder}
        >
          Connect playback order
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={layout.colorByCluster}>Color by cluster</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NoteGraphInsertMenu({
  onInsertTemplate,
  onImport,
}: {
  onInsertTemplate: (templateId: string) => void;
  onImport: (format: NoteGraphImportFormat) => void;
}) {
  return (
    <DropdownMenu>
      <NoteGraphMenuTrigger>
        <LayoutTemplateIcon className="size-3.5 text-(--app-muted)" />
        Insert
      </NoteGraphMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Graph presets</DropdownMenuLabel>
        {noteGraphTemplates.map((template) => (
          <DropdownMenuItem key={template.id} onSelect={() => onInsertTemplate(template.id)}>
            {template.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onImport("mermaid")}>
          <UploadIcon className="size-3.5" />
          Import Mermaid…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onImport("jsoncanvas")}>
          <UploadIcon className="size-3.5" />
          Import JSON Canvas…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NoteGraphExportMenu({ exports }: { exports: NoteGraphExportCommands }) {
  return (
    <DropdownMenu>
      <NoteGraphMenuTrigger>
        <DownloadIcon className="size-3.5 text-(--app-muted)" />
        Export
      </NoteGraphMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={exports.copyPng}>Copy as image</DropdownMenuItem>
        <DropdownMenuItem onSelect={exports.downloadPng}>Download PNG</DropdownMenuItem>
        <DropdownMenuItem onSelect={exports.downloadSvg}>Download SVG</DropdownMenuItem>
        <DropdownMenuItem onSelect={exports.downloadJsonCanvas}>
          Download JSON Canvas (.canvas)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NoteGraphCanvasMenu({
  preferences,
  onPreferencesChange,
  showMinimap,
  onShowMinimapChange,
}: {
  preferences: NoteGraphViewPreferences;
  onPreferencesChange: (patch: Partial<NoteGraphViewPreferences>) => void;
  showMinimap: boolean;
  onShowMinimapChange: (show: boolean) => void;
}) {
  return (
    <DropdownMenu>
      <NoteGraphMenuTrigger>
        <LayoutGridIcon className="size-3.5 text-(--app-muted)" />
        Canvas
      </NoteGraphMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Grid</DropdownMenuLabel>
        {(["dots", "lines", "off"] as const).map((grid) => (
          <DropdownMenuCheckboxItem
            checked={preferences.grid === grid}
            key={grid}
            onCheckedChange={() => onPreferencesChange({ grid })}
          >
            {gridLabels[grid]}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuCheckboxItem
          checked={preferences.snap}
          onCheckedChange={(checked) => onPreferencesChange({ snap: Boolean(checked) })}
        >
          Snap to grid
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={preferences.scrollMode === "zoom"}
          onCheckedChange={() => onPreferencesChange({ scrollMode: "zoom" })}
        >
          Scroll zooms
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={preferences.scrollMode === "pan"}
          onCheckedChange={() => onPreferencesChange({ scrollMode: "pan" })}
        >
          Scroll pans (trackpad)
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        {(["default", "blueprint", "warm"] as const).map((theme) => (
          <DropdownMenuCheckboxItem
            checked={preferences.theme === theme}
            key={theme}
            onCheckedChange={() => onPreferencesChange({ theme })}
          >
            {themeLabels[theme]}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={showMinimap}
          onCheckedChange={(checked) => onShowMinimapChange(Boolean(checked))}
        >
          Show minimap
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type NoteGraphOptionsProps = {
  searchOpen: boolean;
  onOpenSearch: () => void;
  layout: NoteGraphLayoutCommands;
  onInsertTemplate: (templateId: string) => void;
  onImport: (format: NoteGraphImportFormat) => void;
  exports: NoteGraphExportCommands;
  preferences: NoteGraphViewPreferences;
  onPreferencesChange: (patch: Partial<NoteGraphViewPreferences>) => void;
  showMinimap: boolean;
  onShowMinimapChange: (show: boolean) => void;
  focusMode: boolean;
  onToggleFocusMode: () => void;
  outlineOpen: boolean;
  onToggleOutline: () => void;
  canStartWalkthrough: boolean;
  onStartWalkthrough: () => void;
};

function NoteGraphOptions({
  triggerRef,
  searchInputRef,
  ...props
}: NoteGraphOptionsProps & {
  triggerRef: RefObject<HTMLButtonElement | null>;
  searchInputRef: RefObject<HTMLInputElement | null>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <Button
          aria-label="Graph options"
          ref={triggerRef}
          size="icon-xs"
          title="Graph options"
          variant="ghost-muted"
        >
          <EllipsisIcon className="size-4" />
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverContent
          align="end"
          className="w-64"
          onCloseAutoFocus={(event) => {
            if (props.searchOpen) {
              event.preventDefault();
              searchInputRef.current?.focus();
            }
          }}
        >
          <p className="px-2 py-1 text-[11px] font-medium text-(--app-muted)">Graph options</p>
          <Button
            aria-label="Find in graph"
            className="mb-2 w-full justify-start"
            onClick={() => {
              setOpen(false);
              props.onOpenSearch();
            }}
            size="sm"
            variant="ghost-muted"
          >
            <SearchIcon className="size-3.5" />
            Find in graph
            <span className="ml-auto text-[10px] text-(--app-muted)">Ctrl/Cmd+F</span>
          </Button>
          <div className="grid grid-cols-2 gap-1.5 [&>button]:w-full [&>button]:justify-start">
            <NoteGraphLayoutMenu layout={props.layout} />
            <NoteGraphInsertMenu
              onImport={props.onImport}
              onInsertTemplate={props.onInsertTemplate}
            />
            <NoteGraphExportMenu exports={props.exports} />
            <NoteGraphCanvasMenu
              onPreferencesChange={props.onPreferencesChange}
              onShowMinimapChange={props.onShowMinimapChange}
              preferences={props.preferences}
              showMinimap={props.showMinimap}
            />
          </div>
          <div className="mt-2 grid gap-0.5 border-t border-(--app-border)/60 pt-2">
            <Button
              aria-label="Toggle focus mode"
              aria-pressed={props.focusMode}
              className="w-full justify-start"
              onClick={props.onToggleFocusMode}
              size="sm"
              title="Focus mode dims non-neighbors of the selection (F)"
              variant={props.focusMode ? "outline" : "ghost-muted"}
            >
              <FocusIcon className="size-3.5" />
              Focus neighbors
            </Button>
            <Button
              aria-label="Toggle node outline"
              aria-pressed={props.outlineOpen}
              className="w-full justify-start"
              onClick={() => {
                props.onToggleOutline();
                setOpen(false);
              }}
              size="sm"
              variant={props.outlineOpen ? "outline" : "ghost-muted"}
            >
              <ListIcon className="size-3.5" />
              Node outline
            </Button>
            <Button
              aria-label="Start walkthrough"
              className="w-full justify-start"
              disabled={!props.canStartWalkthrough}
              onClick={() => {
                props.onStartWalkthrough();
                setOpen(false);
              }}
              size="sm"
              title="Walkthrough mode (arrow keys, Escape exits)"
              variant="ghost-muted"
            >
              <PlayIcon className="size-3.5" />
              Walkthrough
            </Button>
          </div>
        </PopoverContent>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

/**
 * The graph toolbar: shapes to click or drag onto the canvas, snapshot capture, history, and
 * the Graph options panel. It collapses away while the graph is read-only.
 */
export function NoteGraphToolbar({
  readOnly,
  onAddShape,
  onAddImage,
  snapshotCapturing,
  canCaptureSnapshot,
  onToggleSnapshotCapture,
  onUndo,
  onRedo,
  onAddVideoTimeNode,
  options,
  optionsTriggerRef,
  searchInputRef,
}: {
  readOnly: boolean;
  onAddShape: (shape: NoteGraphNodeShape) => void;
  onAddImage: () => void;
  snapshotCapturing: boolean;
  canCaptureSnapshot: boolean;
  onToggleSnapshotCapture: () => void;
  onUndo: () => void;
  onRedo: () => void;
  /** Only in the learning workspace, where a video plays next to the graph. */
  onAddVideoTimeNode?: () => void;
  options: NoteGraphOptionsProps;
  /** The Graph options button; dialogs opened from its panel return focus to it. */
  optionsTriggerRef: RefObject<HTMLButtonElement | null>;
  /** Where focus goes when the options panel closes while Find is open. */
  searchInputRef: RefObject<HTMLInputElement | null>;
}) {
  return (
    <div
      aria-hidden={readOnly}
      className={cn(
        "grid shrink-0 transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
        readOnly ? "grid-rows-[0fr]" : "grid-rows-[1fr]",
      )}
      data-testid="note-graph-toolbar-shell"
      data-visible={readOnly ? "false" : "true"}
    >
      <div className="min-h-0 overflow-hidden">
        <div
          className={cn(
            "border-b border-(--app-border)/70 bg-(--app-page)/95 px-3 py-2 backdrop-blur transition-opacity duration-200 ease-out motion-reduce:transition-none",
            readOnly ? "opacity-0" : "opacity-100",
          )}
          data-testid="note-graph-toolbar"
          inert={readOnly ? true : undefined}
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5" aria-label="Graph shapes">
              {noteGraphShapeOptions.map((shape) => {
                const Icon = shape.icon;
                return (
                  <Button
                    variant="secondary"
                    className="active:translate-y-0"
                    disabled={readOnly}
                    draggable={!readOnly}
                    key={shape.id}
                    onClick={() => onAddShape(shape.id)}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "copy";
                      event.dataTransfer.setData(noteGraphShapeDragType, shape.id);
                    }}
                    type="button"
                  >
                    <Icon className="size-3.5 text-(--app-muted)" />
                    {shape.label}
                  </Button>
                );
              })}
              <Button
                variant="secondary"
                aria-label="Add image"
                className="active:translate-y-0"
                disabled={readOnly}
                draggable={!readOnly}
                onClick={onAddImage}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "copy";
                  event.dataTransfer.setData(noteGraphShapeDragType, "image");
                }}
                type="button"
              >
                <ImageIcon className="size-3.5 text-(--app-muted)" />
                Image
              </Button>
            </div>
            <Button
              variant={snapshotCapturing ? "default" : "secondary"}
              aria-label="Capture graph snapshot"
              aria-pressed={snapshotCapturing}
              disabled={readOnly || !canCaptureSnapshot}
              onClick={onToggleSnapshotCapture}
              title="Select an area to embed as a live snapshot"
            >
              <FocusIcon className="size-3.5" />
              Snapshot
            </Button>
            <div
              className="ml-auto flex shrink-0 items-center gap-1"
              data-testid="note-graph-toolbar-actions"
            >
              <Button
                aria-label="Undo"
                disabled={readOnly}
                onClick={onUndo}
                size="icon-xs"
                title="Undo (Ctrl+Z)"
                variant="ghost-muted"
              >
                <Undo2Icon className="size-4" />
              </Button>
              <Button
                aria-label="Redo"
                disabled={readOnly}
                onClick={onRedo}
                size="icon-xs"
                title="Redo (Ctrl+Shift+Z)"
                variant="ghost-muted"
              >
                <Redo2Icon className="size-4" />
              </Button>
              {onAddVideoTimeNode ? (
                <Button
                  aria-label="Add node at current video time"
                  disabled={readOnly}
                  onClick={onAddVideoTimeNode}
                  size="icon-xs"
                  title="Add node at current video time"
                  variant="ghost-muted"
                >
                  <ClockIcon className="size-4" />
                </Button>
              ) : null}
              <NoteGraphOptions
                {...options}
                searchInputRef={searchInputRef}
                triggerRef={optionsTriggerRef}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
