import type { NoteDocument as StoredNoteDocument, NoteFolder } from "@loam/shared/notes/noteModel";
import type { HeadingTarget } from "@loam/shared/notes/headingConnections";

import type { NotePartialBlock } from "../editor/noteEditorSchema";

/** A note as the window holds it: its page tabs' blocks typed with the note editor's schema. */
export type NoteDocument = Omit<StoredNoteDocument, "blocksByTab"> & {
  blocksByTab: Record<string, NotePartialBlock[]>;
};

/** A place in the open note that links, heading connections and graph snapshots show. */
export type NotePlace =
  { kind: "video"; seconds: number } | { kind: "graph"; tabId: string } | HeadingTarget;

export type NotesDeleteSelectionInput = {
  noteIds: string[];
  folderIds: string[];
};

export type NotesDeleteSelectionResult = {
  notes: NoteDocument[];
  folders: NoteFolder[];
};
