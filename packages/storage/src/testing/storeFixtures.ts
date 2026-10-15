import type { NewNote } from "@loam/shared/notes/noteModel";

import { createMemoryStorageAdapter } from "../adapters/memoryAdapter";
import type { StorageAdapter } from "../adapter";
import { NotesStore } from "../NotesStore";

const TAB_ID = "tab-1";

export const noteId = (index: number) =>
  `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

export const folderId = (index: number) =>
  `00000000-0000-4000-9000-${String(index).padStart(12, "0")}`;

export const projectId = (index: number) =>
  `00000000-0000-4000-a000-${String(index).padStart(12, "0")}`;

/** A clock that advances one second per read, so every write has a distinct time. */
export const createClock = (start = Date.parse("2026-10-10T09:00:00.000Z")) => {
  let current = start;
  const clock = () => {
    current += 1000;
    return current;
  };
  clock.advance = (ms: number) => {
    current += ms;
  };
  return clock;
};

export const createTestStore = (
  adapter: StorageAdapter = createMemoryStorageAdapter(),
  now: () => number = createClock(),
) => NotesStore.open({ adapter, now });

type TextRun = { type: "text"; text: string; styles: Record<string, never> };
type Inline = TextRun | { type: "link"; href: string; content: TextRun[] };

export const text = (value: string): TextRun => ({ type: "text", text: value, styles: {} });

/** An in-app note link, stored the way the editor's @-mentions store it. */
export const noteLink = (targetId: string, label: string): Inline => ({
  type: "link",
  href: `/notes?noteId=${targetId}`,
  content: [text(label)],
});

export const paragraph = (...content: Inline[]) => ({
  id: crypto.randomUUID(),
  type: "paragraph",
  props: {},
  content,
  children: [],
});

/** A one-tab note as the editor creates it. */
export const newNote = (
  id: string,
  {
    title = "Untitled",
    blocks = [paragraph(text("Body"))],
    folderId,
    projectId,
    parentNoteId,
  }: {
    title?: string;
    blocks?: unknown[];
    folderId?: string;
    projectId?: string;
    parentNoteId?: string;
  } = {},
): NewNote => ({
  id,
  title,
  tabs: [{ id: TAB_ID, title: "Notes", kind: "page" }],
  blocksByTab: { [TAB_ID]: blocks },
  activeTabId: TAB_ID,
  graphsByTab: {},
  tablesByTab: {},
  folderId: folderId ?? null,
  projectId: projectId ?? null,
  ...(parentNoteId && { parentNoteId }),
});

export const createNote = (
  store: NotesStore,
  id: string,
  options?: Parameters<typeof newNote>[1],
) => store.createNote(newNote(id, options));

/** Replaces the body of a one-tab note made by `newNote`. */
export const bodyPatch = (...blocks: unknown[]) => ({ blocksByTab: { [TAB_ID]: blocks } });
