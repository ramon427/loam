/**
 * Sub-notes: a note can sit inside another note instead of in a folder or at a
 * project's top level. A note in a folder is never inside a note, even if an
 * older version kept a parent on it while moving it there.
 */
type ParentedNote = {
  id: string;
  folderId?: string | null;
  parentNoteId?: string | null;
};

/**
 * Each sub-note's parent, by note id, for notes whose parent is in `notes`.
 * Notes that would end up inside themselves (two computers nesting two notes
 * in each other at once) have none, so every note still shows somewhere.
 */
export const resolveNoteParents = (notes: Iterable<ParentedNote>) => {
  const listed = [...notes];
  const ids = new Set(listed.map((note) => note.id));
  const parents = new Map<string, string>();
  for (const note of listed)
    if (!note.folderId && note.parentNoteId && ids.has(note.parentNoteId))
      parents.set(note.id, note.parentNoteId);
  const settled = new Set<string>();
  for (const start of parents.keys()) {
    const path: string[] = [];
    const onPath = new Set<string>();
    let current: string | undefined = start;
    while (current && !settled.has(current)) {
      if (onPath.has(current)) {
        for (const member of path.slice(path.indexOf(current))) parents.delete(member);
        break;
      }
      path.push(current);
      onPath.add(current);
      current = parents.get(current);
    }
    for (const id of path) settled.add(id);
  }
  return parents;
};

/** Whether `noteId` is `ancestorId` or somewhere inside it. */
export const isInsideNote = (
  parents: ReadonlyMap<string, string>,
  noteId: string,
  ancestorId: string,
) => {
  for (let current: string | undefined = noteId; current; current = parents.get(current))
    if (current === ancestorId) return true;
  return false;
};
