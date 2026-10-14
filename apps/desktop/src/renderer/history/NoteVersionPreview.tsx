import type { MouseEvent } from "react";

import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";

import { isEditorLink } from "@loam/shared/notes/noteLinks";
import type { NoteContent, NoteGraph, NoteTable } from "@loam/shared/notes/noteModel";

import { blockNoteComponents } from "../editor/blocknote/blockNoteComponents";
import { blockNoteEditorRootClassName, editorStyles } from "../editor/blocknote/blockNoteStyles";
import { noteEditorSchema, type NotePartialBlock } from "../editor/noteEditorSchema";
import { useEditorTheme } from "../editor/useEditorTheme";
import { NoteGraphSnapshotContext } from "../graph/NoteGraphSnapshotBlock";
import { NoteGraphSnapshotPreview } from "../graph/NoteGraphSnapshotPreview";
import { getNoteGraphBounds } from "../graph/noteGraphGeometry";
import { mediaSrc } from "../media/mediaSrc";
import { noteTableCellLabel } from "../table/noteTable";
import { cn } from "../ui/cn";

const emptyTab = (text: string) => <p className="text-sm text-(--app-muted)">{text}</p>;

/**
 * Web links open in the browser. Links to notes and to places in this one do
 * nothing: a read-only editor would follow them as page loads.
 */
const openWebLinks = (event: MouseEvent<HTMLElement>) => {
  const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (!anchor) return;
  event.preventDefault();
  const href = anchor.getAttribute("href") ?? "";
  if (/^(https?|mailto):/i.test(href)) window.open(href);
};

function VersionText({ blocks }: { blocks: unknown[] }) {
  const theme = useEditorTheme();
  const editor = useCreateBlockNote(
    {
      schema: noteEditorSchema,
      initialContent: blocks as NotePartialBlock[],
      resolveFileUrl: async (url) => mediaSrc(url) ?? "",
      links: { isValidLink: isEditorLink },
    },
    [blocks],
  );
  return (
    <div
      className={cn(
        editorStyles.editorRoot,
        editorStyles.documentPreview,
        blockNoteEditorRootClassName,
      )}
      onClickCapture={openWebLinks}
    >
      <BlockNoteView
        editor={editor}
        editable={false}
        theme={theme}
        shadCNComponents={blockNoteComponents}
        slashMenu={false}
        emojiPicker={false}
        sideMenu={false}
        formattingToolbar={false}
        linkToolbar={false}
        filePanel={false}
        tableHandles={false}
        comments={false}
      />
    </div>
  );
}

const VersionGraph = ({ graph, title }: { graph: NoteGraph | undefined; title: string }) =>
  graph?.nodes.length ? (
    <NoteGraphSnapshotPreview
      graph={graph}
      bounds={getNoteGraphBounds(graph.nodes)}
      label={title}
    />
  ) : (
    emptyTab("This graph has no nodes.")
  );

const VersionTable = ({ table, title }: { table: NoteTable | undefined; title: string }) =>
  table?.columns.length ? (
    <div className="overflow-x-auto rounded-lg border border-(--app-border)">
      <table aria-label={title} className="w-full border-collapse text-left text-sm">
        <thead className="bg-(--app-surface-2) text-(--app-muted)">
          <tr>
            {table.columns.map((column) => (
              <th key={column.id} className="px-3 py-2 font-medium">
                {column.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row.id} className="border-t border-(--app-border)">
              {table.columns.map((column) => (
                <td key={column.id} className="px-3 py-2">
                  {noteTableCellLabel(column, row.cells[column.id])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    emptyTab("This table is empty.")
  );

/** A saved version of a note, read-only, one section per tab. */
export function NoteVersionPreview({ noteId, note }: { noteId: string; note: NoteContent }) {
  return (
    // Graph snapshots of this note show the version's graphs, not today's.
    <NoteGraphSnapshotContext value={{ note: { ...note, id: noteId } }}>
      <div className="space-y-6 border-t border-(--app-border) pt-5">
        {note.tabs.map((tab) => {
          const blocks = note.blocksByTab[tab.id] ?? [];
          let content;
          if (tab.kind === "graph")
            content = <VersionGraph graph={note.graphsByTab?.[tab.id]} title={tab.title} />;
          else if (tab.kind === "table" || tab.kind === "board")
            content = <VersionTable table={note.tablesByTab?.[tab.id]} title={tab.title} />;
          else if (tab.kind === "embed")
            content = note.embedsByTab?.[tab.id]?.url ? (
              <p className="text-sm break-all">{note.embedsByTab[tab.id]!.url}</p>
            ) : (
              emptyTab("Nothing was embedded.")
            );
          else if (blocks.length === 0) content = emptyTab("This tab has no text.");
          else content = <VersionText blocks={blocks} />;
          return (
            <section key={tab.id} aria-label={tab.title} className="space-y-2">
              <h3 className="text-xs font-medium text-(--app-muted)">{tab.title}</h3>
              {content}
            </section>
          );
        })}
      </div>
    </NoteGraphSnapshotContext>
  );
}
