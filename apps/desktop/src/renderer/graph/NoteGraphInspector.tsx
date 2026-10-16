import { ImageIcon, LinkIcon, XIcon } from "lucide-react";

import { isNoteGraphHexColor } from "@loam/shared/notes/noteGraphColors";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Label } from "../ui/Label";
import { Textarea } from "../ui/Textarea";
import { cn } from "../ui/cn";

import { NoteGraphNodeImageThumbnail } from "./NoteGraphNodeImageThumbnail";
import { noteGraphEdgeRelations } from "./noteGraphConnectors";
import type { NoteGraphEdge, NoteGraphNode } from "@loam/shared/notes/noteModel";

/**
 * Every inspector keystroke still publishes immediately, so the graph owner and
 * the note save keep the latest text. The group string only tells the tab
 * history that a burst of edits to one field is a single undo step.
 */
function noteGraphInspectorNodeFieldGroup(nodeId: string, field: "notes" | "title") {
  return `node:${nodeId}:${field}`;
}

function noteGraphInspectorEdgeLabelGroup(edgeId: string) {
  return `edge:${edgeId}:label`;
}

type NodeEditorProps = {
  node: NoteGraphNode;
  readOnly: boolean;
  /** `historyGroup` folds a burst of edits to one field into one undo step. */
  onChange: (patch: Partial<NoteGraphNode>, historyGroup?: string) => void;
  onRequestImage: () => void;
};

function NoteGraphNodeImageField({ node, readOnly, onChange, onRequestImage }: NodeEditorProps) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">Image</Label>
      {node.imageUrl ? (
        <div className="flex items-center gap-2">
          <NoteGraphNodeImageThumbnail imageUrl={node.imageUrl} title={node.title} />
          <div className="flex gap-1">
            <Button
              aria-label="Replace node image"
              disabled={readOnly}
              onClick={() => onRequestImage()}
              size="sm"
              variant="outline"
            >
              Replace
            </Button>
            <Button
              aria-label="Remove node image"
              disabled={readOnly}
              onClick={() =>
                onChange({
                  imageUrl: undefined,
                })
              }
              size="sm"
              variant="ghost-muted"
            >
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <Button
          aria-label="Add image to node"
          className="w-fit"
          disabled={readOnly}
          onClick={() => onRequestImage()}
          size="sm"
          variant="outline"
        >
          <ImageIcon className="size-4" />
          Add image
        </Button>
      )}
    </div>
  );
}

type NoteGraphNodeInspectorProps = NodeEditorProps & {
  frameMemberCount: number;
  onToggleFrame: () => void;
  onSyncTitleFromHeading: () => void;
  onMatchHeadingColor: () => void;
  onManageHeadings: () => void;
};

/**
 * What the selection toolbar does not cover. Titles are edited on the node itself, except an
 * image node's, which double-click replaces the image on instead.
 */
function NoteGraphNodeInspector(props: NoteGraphNodeInspectorProps) {
  const { node, readOnly, onChange } = props;
  const isImage = (node.shape ?? "process") === "image";
  const headingCount = node.headingBlockIds?.length ?? 0;

  return (
    <div className="grid gap-3">
      {isImage ? (
        <>
          <NoteGraphNodeImageField {...props} />
          <div className="grid gap-1.5">
            <Label className="text-xs" htmlFor="note-graph-node-title">
              Title
            </Label>
            <Input
              id="note-graph-node-title"
              value={node.title}
              disabled={readOnly}
              onChange={(event) =>
                onChange(
                  {
                    title: event.target.value || "Untitled node",
                  },
                  noteGraphInspectorNodeFieldGroup(node.id, "title"),
                )
              }
            />
          </div>
        </>
      ) : (
        <div className="grid gap-1.5">
          <Label className="text-xs" htmlFor="note-graph-node-notes">
            Notes
          </Label>
          <Textarea
            id="note-graph-node-notes"
            className="min-h-24"
            maxLength={1000}
            value={node.notes ?? ""}
            disabled={readOnly}
            onBlur={(event) => {
              const nextNotes = event.target.value.trim();
              onChange(
                {
                  notes: nextNotes || undefined,
                },
                noteGraphInspectorNodeFieldGroup(node.id, "notes"),
              );
            }}
            onChange={(event) =>
              onChange(
                {
                  notes: event.target.value || undefined,
                },
                noteGraphInspectorNodeFieldGroup(node.id, "notes"),
              )
            }
          />
        </div>
      )}
      {node.shape === "frame" ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-(--app-muted)">{props.frameMemberCount} nodes inside</p>
          <Button
            disabled={readOnly}
            onClick={() => props.onToggleFrame()}
            size="sm"
            variant="outline"
          >
            {node.collapsed ? "Expand frame" : "Collapse frame"}
          </Button>
        </div>
      ) : null}
      <div className="grid gap-1.5">
        <Label className="text-xs">Headings</Label>
        <Button
          aria-label={`Manage heading connections for ${node.title || "Untitled node"}`}
          className="min-h-11 w-fit md:min-h-7"
          onClick={() => props.onManageHeadings()}
          size="sm"
          variant="outline"
        >
          <LinkIcon className="size-4" />
          {headingCount > 0 ? `Connected headings (${headingCount})` : "Connect headings"}
        </Button>
        {headingCount > 0 ? (
          <div className="flex flex-wrap gap-1">
            <Button
              disabled={readOnly || Boolean(node.locked)}
              onClick={() => props.onSyncTitleFromHeading()}
              size="sm"
              title="Copy the first connected heading title onto this node"
              variant="ghost-muted"
            >
              Sync title from heading
            </Button>
            <Button
              disabled={readOnly || Boolean(node.locked)}
              onClick={() => props.onMatchHeadingColor()}
              size="sm"
              title="Color this node by its heading tab"
              variant="ghost-muted"
            >
              Match heading color
            </Button>
          </div>
        ) : null}
      </div>
      {!isImage ? (
        <div className="grid gap-1.5">
          <Label className="text-xs" htmlFor="note-graph-node-hex">
            Custom color
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="note-graph-node-hex"
              className="h-8 w-28 font-mono text-xs"
              defaultValue={node.colorHex ?? ""}
              disabled={readOnly || Boolean(node.locked)}
              key={`hex-${node.id}-${node.colorHex ?? ""}`}
              onChange={(event) => {
                const value = event.target.value.trim();
                if (isNoteGraphHexColor(value)) {
                  onChange({ colorHex: value });
                }
              }}
              placeholder="#0ea5e9"
            />
            {node.colorHex ? (
              <Button
                aria-label="Clear custom color"
                disabled={readOnly || Boolean(node.locked)}
                onClick={() =>
                  onChange({
                    colorHex: undefined,
                  })
                }
                size="sm"
                variant="ghost-muted"
              >
                Clear
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type NoteGraphEdgeInspectorProps = {
  edge: NoteGraphEdge;
  readOnly: boolean;
  onChange: (patch: Partial<NoteGraphEdge>, historyGroup?: string) => void;
};

/** Path, arrows, color and lock are on the selection toolbar. */
function NoteGraphEdgeInspector({ edge, readOnly, onChange }: NoteGraphEdgeInspectorProps) {
  const locked = readOnly || Boolean(edge.locked);
  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label className="text-xs" htmlFor="note-graph-edge-label">
          Label
        </Label>
        <Input
          id="note-graph-edge-label"
          value={edge.label ?? ""}
          disabled={readOnly}
          onBlur={(event) => {
            const nextLabel = event.target.value.trim();
            onChange(
              {
                label: nextLabel || undefined,
              },
              noteGraphInspectorEdgeLabelGroup(edge.id),
            );
          }}
          onChange={(event) =>
            onChange(
              {
                label: event.target.value || undefined,
              },
              noteGraphInspectorEdgeLabelGroup(edge.id),
            )
          }
        />
      </div>
      <div className="grid gap-1.5">
        <Label className="text-xs">Relation</Label>
        <div className="flex flex-wrap gap-1">
          {noteGraphEdgeRelations.map((relation) => (
            <Button
              disabled={locked}
              key={relation.id}
              onClick={() =>
                onChange({
                  label: relation.label,
                  color: relation.color,
                  dashed: relation.dashed,
                })
              }
              size="sm"
              variant="ghost-muted"
            >
              {relation.label}
            </Button>
          ))}
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label className="text-xs">Line</Label>
        <div className="flex flex-wrap items-center gap-1">
          <Button
            aria-pressed={Boolean(edge.dashed)}
            disabled={locked}
            onClick={() =>
              onChange({
                dashed: !edge.dashed,
              })
            }
            size="sm"
            variant={edge.dashed ? "outline" : "ghost-muted"}
          >
            Dashed
          </Button>
          {([1.4, 1.8, 2.6, 3.4] as const).map((width) => (
            <Button
              aria-label={`Connector width ${width}`}
              aria-pressed={(edge.width ?? 1.8) === width}
              disabled={locked}
              key={width}
              onClick={() =>
                onChange({
                  width: width === 1.8 ? undefined : width,
                })
              }
              size="sm"
              variant={(edge.width ?? 1.8) === width ? "outline" : "ghost-muted"}
            >
              {width}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Details of the selected node or connector, opened from the selection toolbar. */
export function NoteGraphInspector({
  className,
  onClose,
  ...selection
}: { className?: string; onClose: () => void } & (
  { node: NoteGraphNodeInspectorProps } | { edge: NoteGraphEdgeInspectorProps }
)) {
  const kind = "node" in selection ? "Node" : "Connector";
  return (
    <aside
      aria-label={`${kind} details`}
      className={cn(
        "min-h-0 overflow-y-auto rounded-md border border-(--app-border)/80 surface-glass p-3 shadow-lg",
        className,
      )}
    >
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold text-(--app-text)">{kind} details</p>
        <Button aria-label="Close details" onClick={onClose} size="icon-xs" variant="ghost-muted">
          <XIcon className="size-4" />
        </Button>
      </div>
      {"node" in selection ? (
        <NoteGraphNodeInspector {...selection.node} />
      ) : (
        <NoteGraphEdgeInspector {...selection.edge} />
      )}
    </aside>
  );
}
