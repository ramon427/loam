import { useNotesWorkspace } from "../workspace/NotesWorkspace";

import { NotesSidebarLoading, NotesSidebarReadError } from "./NotesSidebarLoading";
import { NotesTree, type NotesTreeProps } from "./NotesTree";

/** The notes library in the sidebar, once it has loaded. */
export function NotesSidebar(props: NotesTreeProps) {
  const { loadError, isLoading, reloadLibrary } = useNotesWorkspace();
  if (loadError) return <NotesSidebarReadError onRetry={reloadLibrary} />;
  if (isLoading) return <NotesSidebarLoading />;
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <NotesTree {...props} />
    </div>
  );
}
