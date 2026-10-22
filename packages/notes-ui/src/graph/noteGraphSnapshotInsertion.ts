import type { NotePartialBlock } from "../editor/noteEditorSchema";
import { tabKindOf, type NoteGraphSnapshot, type NoteTab } from "@loam/shared/notes/noteModel";
import { createUuid } from "@loam/shared/utils/uuid";
import { MAX_TABS } from "../note/noteTabs";
import type { NoteDocument } from "../workspace/types";

/** A block showing a crop of a graph, as a note stores it. */
export const createNoteGraphSnapshotBlock = (snapshot: NoteGraphSnapshot): NotePartialBlock => ({
  id: createUuid(),
  type: "graphSnapshot",
  props: snapshot,
});

export const insertNoteGraphSnapshot = (
  note: NoteDocument,
  snapshot: NoteGraphSnapshot,
  tabId?: string,
): NoteDocument | null => {
  let tab = tabId
    ? note.tabs.find((entry) => entry.id === tabId && tabKindOf(entry) === "page")
    : note.tabs.find((entry) => tabKindOf(entry) === "page");
  if (tabId && !tab) return null;
  let tabs = note.tabs;
  if (!tab) {
    if (tabs.length >= MAX_TABS) return null;
    tab = {
      id: createUuid(),
      title: "Notes",
      kind: "page",
      position: tabs.length,
    } satisfies NoteTab;
    tabs = [...tabs, tab];
  }
  const blocks = note.blocksByTab[tab.id] ?? [];
  const last = blocks.at(-1);
  const replaceEmpty =
    last &&
    (last.type ?? "paragraph") === "paragraph" &&
    (!last.children || last.children.length === 0) &&
    (!last.content || (Array.isArray(last.content) && last.content.length === 0));
  return {
    ...note,
    tabs,
    activeTabId: tab.id,
    updatedAt: new Date().toISOString(),
    blocksByTab: {
      ...note.blocksByTab,
      [tab.id]: [
        ...(replaceEmpty ? blocks.slice(0, -1) : blocks),
        createNoteGraphSnapshotBlock(snapshot),
        { id: createUuid(), type: "paragraph", content: [] },
      ],
    },
  };
};
