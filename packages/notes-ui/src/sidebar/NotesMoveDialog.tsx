import { FolderIcon, FolderOutputIcon, LayoutListIcon } from "lucide-react";
import { useState, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "../ui/cn";
import { Dialog, DialogContent, DialogTitle } from "../ui/Dialog";

import { NoteProjectIcon } from "./NoteProjectIcon";
import type { NotesTreeMenuContext } from "./NotesTreeMenu";
import { getNoteTitle, type NotesTreeItem } from "./notesTreeModel";

type Place = {
  key: string;
  kind: "folder" | "project";
  /** null is "No folder" or "No project". */
  id: string | null;
  label: string;
  detail?: string;
  icon: ReactNode;
  current: boolean;
};

const matches = (place: Place, words: string[]) => {
  const text = `${place.label} ${place.detail ?? ""}`.toLowerCase();
  return words.every((word) => text.includes(word));
};

/**
 * Every place the items can go, folders first and then projects, in one list that typing
 * filters. Notes go to folders or projects; folders only to projects. Where they all are now
 * is listed but can't be picked.
 */
function placesFor(items: readonly NotesTreeItem[], context: NotesTreeMenuContext) {
  const notes = items.flatMap((item) =>
    item.kind === "note" ? (context.notesById.get(item.id) ?? []) : [],
  );
  const onlyNotes = notes.length === items.length;
  const folderOf = (folderId: string | undefined) =>
    folderId && context.foldersById.has(folderId) ? folderId : null;
  const projectOf = (item: NotesTreeItem) => {
    if (item.kind === "folder") return context.foldersById.get(item.id)?.projectId ?? null;
    const note = context.notesById.get(item.id);
    const folder = note?.folderId ? context.foldersById.get(note.folderId) : undefined;
    return (folder ? folder.projectId : note?.projectId) ?? null;
  };
  const folders = new Set(notes.map((note) => folderOf(note.folderId)));
  const projects = new Set(items.map(projectOf));
  const places: Place[] = [];
  if (onlyNotes) {
    places.push({
      key: "folder:none",
      kind: "folder",
      id: null,
      label: "No folder",
      icon: <FolderOutputIcon aria-hidden="true" />,
      current: folders.size === 1 && folders.has(null),
    });
    for (const folder of context.folders) {
      const project = folder.projectId ? context.projectsById.get(folder.projectId) : undefined;
      places.push({
        key: `folder:${folder.id}`,
        kind: "folder",
        id: folder.id,
        label: folder.name,
        ...(project && { detail: project.name }),
        icon: <FolderIcon aria-hidden="true" />,
        current: folders.size === 1 && folders.has(folder.id),
      });
    }
  }
  if (context.projects.length > 0) {
    places.push({
      key: "project:none",
      kind: "project",
      id: null,
      label: "No project",
      icon: <LayoutListIcon aria-hidden="true" />,
      current: projects.size === 1 && projects.has(null),
    });
    for (const project of context.projects)
      places.push({
        key: `project:${project.id}`,
        kind: "project",
        id: project.id,
        label: project.name,
        detail: "Project",
        icon: <NoteProjectIcon icon={project.icon} />,
        current: projects.size === 1 && projects.has(project.id),
      });
  }
  return places;
}

function describeItems(items: readonly NotesTreeItem[], context: NotesTreeMenuContext) {
  if (items.length !== 1) return `${items.length} items`;
  const item = items[0]!;
  if (item.kind === "folder") return context.foldersById.get(item.id)?.name ?? "folder";
  const note = context.notesById.get(item.id);
  return note ? `“${getNoteTitle(note)}”` : "note";
}

/** "Move to…": one list of folders and projects for the chosen notes or folders. */
export function NotesMoveDialog({ context }: { context: NotesTreeMenuContext }) {
  const { commands } = context;
  const items = commands.moveRequest;
  return (
    <Dialog open={items !== null} onOpenChange={(open) => !open && commands.requestMove(null)}>
      {items ? <MovePicker items={items} context={context} /> : null}
    </Dialog>
  );
}

function MovePicker({
  items,
  context,
}: {
  items: readonly NotesTreeItem[];
  context: NotesTreeMenuContext;
}) {
  const { commands } = context;
  const places = placesFor(items, context);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = places.filter((place) => matches(place, words));
  const choosable = shown.filter((place) => !place.current);
  const active = choosable[Math.min(selected, Math.max(0, choosable.length - 1))];

  const move = (place: Place | undefined) => {
    if (!place || place.current) return;
    commands.requestMove(null);
    const noteIds = items.filter((item) => item.kind === "note").map((item) => item.id);
    if (place.kind === "folder") {
      if (place.id) context.openFolder(place.id);
      void commands.moveNotes(noteIds, place.id);
      return;
    }
    if (place.id) context.openProject(place.id);
    void commands.moveItemsToProject(
      { noteIds, folderIds: items.filter((item) => item.kind === "folder").map((item) => item.id) },
      place.id,
    );
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const count = Math.max(1, choosable.length);
    const index = active ? choosable.indexOf(active) : 0;
    if (event.key === "ArrowDown") setSelected((index + 1) % count);
    else if (event.key === "ArrowUp") setSelected((index - 1 + count) % count);
    else if (event.key === "Enter") move(active);
    else return;
    event.preventDefault();
  };

  return (
    <DialogContent
      showCloseButton={false}
      className="top-[20%] max-w-lg translate-y-0 gap-0 p-0"
      aria-describedby={undefined}
    >
      <DialogTitle className="sr-only">Move {describeItems(items, context)}</DialogTitle>
      <input
        autoFocus
        role="combobox"
        aria-expanded
        aria-controls="notes-move-list"
        aria-activedescendant={active ? `move-${active.key}` : undefined}
        aria-label="Search folders and projects"
        placeholder={`Move ${describeItems(items, context)} to…`}
        className="h-11 w-full border-b border-(--app-border) bg-transparent px-4 text-sm text-(--app-text) outline-none placeholder:text-(--app-placeholder)"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setSelected(0);
        }}
        onKeyDown={onKeyDown}
      />
      <div
        id="notes-move-list"
        role="listbox"
        aria-label="Places"
        className="max-h-80 overflow-y-auto p-1"
      >
        {shown.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-(--app-muted)">Nothing matches.</p>
        ) : (
          shown.map((place) => (
            <div
              key={place.key}
              id={`move-${place.key}`}
              role="option"
              aria-label={[place.label, place.current ? "here now" : place.detail]
                .filter(Boolean)
                .join(", ")}
              aria-selected={place === active}
              aria-disabled={place.current || undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-(--radius-control) px-3 py-2 text-xs text-(--app-text) [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-(--app-muted)",
                place.current ? "opacity-50" : "cursor-pointer",
                place === active && "bg-(--menu-item-hover-bg)",
              )}
              onMouseMove={() => {
                if (!place.current) setSelected(choosable.indexOf(place));
              }}
              onClick={() => move(place)}
            >
              {place.icon}
              <span className="min-w-0 flex-1 truncate">{place.label}</span>
              {place.current ? (
                <span className="shrink-0 text-(--app-muted)">Here now</span>
              ) : place.detail ? (
                <span className="shrink-0 text-(--app-muted)">{place.detail}</span>
              ) : null}
            </div>
          ))
        )}
      </div>
    </DialogContent>
  );
}
