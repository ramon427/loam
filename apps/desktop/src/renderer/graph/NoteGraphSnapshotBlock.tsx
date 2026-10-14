import { createContext, use } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { FocusIcon, ArrowUpRightIcon } from "lucide-react";
import type { NoteGraphSnapshot } from "@loam/shared/notes/noteModel";
import {
  parseNoteGraphSnapshot,
  readNoteGraphSnapshot,
} from "@loam/shared/notes/noteGraphSnapshot";
import { useNoteDocument } from "../workspace/NotesWorkspace";
import { BridgeError } from "../bridge";
import { NoteGraphSnapshotPreview } from "./NoteGraphSnapshotPreview";
import styles from "./noteGraphSnapshot.module.css";
import type { NoteDocument } from "../workspace/types";

/** The note a snapshot sits in, whose own graphs it shows without fetching them. */
export const NoteGraphSnapshotContext = createContext<{
  note: Pick<NoteDocument, "id" | "tabs" | "graphsByTab">;
  onOpenSource?: (snapshot: NoteGraphSnapshot) => void;
} | null>(null);

function SnapshotSource({ snapshot }: { snapshot: NoteGraphSnapshot }) {
  const context = use(NoteGraphSnapshotContext);
  const isCurrentNote = context?.note.id === snapshot.noteId;
  const source = useNoteDocument(isCurrentNote ? null : snapshot.noteId);
  const note = isCurrentNote ? context.note : source.data;
  const graph = note?.graphsByTab?.[snapshot.tabId];
  const title = note?.tabs.find((tab) => tab.id === snapshot.tabId)?.title || "Graph";
  const available = Boolean(graph?.enabled);
  const loadError =
    source.error && !(source.error instanceof BridgeError && source.error.code === "NOT_FOUND");
  return (
    <div className={styles.snapshot} contentEditable={false} data-graph-snapshot="">
      <div className={styles.header}>
        <div className={styles.source}>
          <FocusIcon size={13} />
          <span>{title}</span>
          {available ? <span className={styles.live}>Live</span> : null}
        </div>
        {available && context?.onOpenSource ? (
          <button
            type="button"
            onClick={() => context.onOpenSource?.(snapshot)}
            aria-label="Open source graph"
            title="Edit in the source graph"
          >
            <ArrowUpRightIcon size={14} />
          </button>
        ) : null}
      </div>
      {available && graph ? (
        <NoteGraphSnapshotPreview
          graph={graph}
          bounds={snapshot}
          label={`Live snapshot of ${title}`}
        />
      ) : (
        <p className={styles.notice} role="status">
          {!isCurrentNote && source.isLoading
            ? "Loading graph snapshot…"
            : loadError
              ? "Could not load the source graph."
              : "The source graph is no longer available."}
          {loadError ? (
            <button
              className={styles.retry}
              type="button"
              onClick={() => {
                void source.refetch();
              }}
            >
              Try again
            </button>
          ) : null}
        </p>
      )}
    </div>
  );
}

export function NoteGraphSnapshotContent({ props }: { props: unknown }) {
  const snapshot = readNoteGraphSnapshot(props);
  return snapshot ? (
    <SnapshotSource snapshot={snapshot} />
  ) : (
    <div className={styles.notice} contentEditable={false}>
      This graph snapshot is unavailable.
    </div>
  );
}

export const graphSnapshotBlockSpec = createReactBlockSpec(
  {
    type: "graphSnapshot",
    propSchema: {
      noteId: { default: "" },
      tabId: { default: "" },
      x: { default: 0 },
      y: { default: 0 },
      width: { default: 640 },
      height: { default: 360 },
    },
    content: "none",
  },
  {
    render: ({ block }) => <NoteGraphSnapshotContent props={block.props} />,
    toExternalHTML: ({ block }) => (
      <figure data-loam-graph-snapshot={JSON.stringify(block.props)}>
        <figcaption>Live graph snapshot</figcaption>
      </figure>
    ),
    parse: (element) => {
      const data = element.getAttribute("data-loam-graph-snapshot");
      return (data && parseNoteGraphSnapshot(data)) || undefined;
    },
  },
);
