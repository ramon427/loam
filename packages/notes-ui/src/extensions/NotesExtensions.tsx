import { createContext, useContext, type ComponentType, type ReactNode } from "react";

import type { NoteBlockEditor } from "../editor/noteEditorSchema";
import type { SlashCommand } from "../editor/slashMenuModel";

/** The places in the notes screens an app may draw into. */
export type NotesSlotName = "note.header" | "sidebar.footer";

/** A command the command palette lists beside the app's own. */
export type NotesExtensionCommand = {
  id: string;
  title: string;
  /** Who the command comes from, shown after its title. */
  detail?: string;
  shortcut?: string;
  run: () => void;
};

/**
 * What the app embedding the notes adds to them. Loam's window fills this from its plugins;
 * another app passes its own parts. Everything is optional.
 */
export type NotesExtensions = {
  /** Draws the app's part of a slot. */
  Slot?: ComponentType<{ name: NotesSlotName; props: Record<string, unknown>; className?: string }>;
  /** Extra slash menu items for a page; a hook, so it may subscribe to the app's state. */
  useSlashItems?: (context: { editor: NoteBlockEditor; noteId: string }) => readonly SlashCommand[];
  /** Extra command palette entries; a hook, like `useSlashItems`. */
  useCommands?: () => readonly NotesExtensionCommand[];
  /**
   * Asked before a note opens: a reason refuses the open, nothing allows it. Return null to
   * open right away without waiting.
   */
  beforeOpenNote?: (noteId: string) => Promise<string | undefined> | null;
  /** The row along the top of the note, holding `children` (its title and actions). */
  MainHeader?: ComponentType<{ children?: ReactNode }>;
};

const NotesExtensionsContext = createContext<NotesExtensions>({});

export function NotesExtensionsProvider({
  value,
  children,
}: {
  value: NotesExtensions;
  children: ReactNode;
}) {
  return <NotesExtensionsContext value={value}>{children}</NotesExtensionsContext>;
}

export const useNotesExtensions = () => useContext(NotesExtensionsContext);

const noItems: readonly never[] = [];
const noSlashItems = () => noItems;

/** The app's slash menu items for this page. */
export const useExtensionSlashItems = (context: { editor: NoteBlockEditor; noteId: string }) =>
  (useNotesExtensions().useSlashItems ?? noSlashItems)(context);

/** The app's command palette entries. */
export const useExtensionCommands = () => (useNotesExtensions().useCommands ?? noSlashItems)();

/** Draws the app's part of a slot, or nothing. */
export function NotesSlot(props: {
  name: NotesSlotName;
  props: Record<string, unknown>;
  className?: string;
}) {
  const { Slot } = useNotesExtensions();
  return Slot ? <Slot {...props} /> : null;
}

function PlainHeader({ children }: { children?: ReactNode }) {
  return <header className="flex items-center">{children}</header>;
}

/** The note's top row, as the app draws it. */
export function NotesMainHeader({ children }: { children?: ReactNode }) {
  const { MainHeader = PlainHeader } = useNotesExtensions();
  return <MainHeader>{children}</MainHeader>;
}
