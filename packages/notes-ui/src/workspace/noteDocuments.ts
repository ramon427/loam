import { createUuid } from "@loam/shared/utils/uuid";

import { createDefaultBlocks } from "../editor/blocknote/editorTabTemplates";
import type { NoteDocument } from "./types";
import type { FileTabKind, NoteFile, NoteTab } from "@loam/shared/notes/noteModel";

/** A new note with one empty page tab. */
export const createNoteDocument = (title = ""): NoteDocument => {
  const tab: NoteTab = { id: createUuid(), title: "Notes", kind: "page" };
  return {
    id: createUuid(),
    title,
    updatedAt: new Date().toISOString(),
    tabs: [tab],
    blocksByTab: { [tab.id]: createDefaultBlocks() },
    activeTabId: tab.id,
    graphsByTab: {},
    tablesByTab: {},
  };
};

/** The name a file goes by in a note: its file name without the extension. */
export const fileTitleOf = (file: NoteFile) => file.name.replace(/\.[^.]+$/, "") || file.name;

/** A new note named after `file`, with one tab showing it. */
export const createFileNoteDocument = (kind: FileTabKind, file: NoteFile): NoteDocument => {
  const tab: NoteTab = { id: createUuid(), title: fileTitleOf(file), kind };
  return {
    ...createNoteDocument(fileTitleOf(file)),
    tabs: [tab],
    blocksByTab: { [tab.id]: [] },
    activeTabId: tab.id,
    filesByTab: { [tab.id]: file },
  };
};
