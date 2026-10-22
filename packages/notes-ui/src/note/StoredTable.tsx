import { useEffect, useEffectEvent, useState, type ReactNode } from "react";

import type { NoteTable } from "@loam/shared/notes/noteModel";
import type { NoteDocument } from "../workspace/types";

/**
 * A table or board tab saved without its table gets a default one, made and
 * saved once, so its ids stay the same between renders.
 */
export function StoredTable({
  note,
  tabId,
  create,
  onCreate,
  children,
}: {
  note: NoteDocument;
  tabId: string;
  create: (note: NoteDocument) => NoteTable;
  onCreate: (table: NoteTable) => void;
  children: (table: NoteTable) => ReactNode;
}) {
  const stored = note.tablesByTab?.[tabId];
  const [created] = useState(() => create(note));
  const saveCreated = useEffectEvent(() => {
    if (!stored) onCreate(created);
  });
  useEffect(() => {
    saveCreated();
  }, []);
  return children(stored ?? created);
}
