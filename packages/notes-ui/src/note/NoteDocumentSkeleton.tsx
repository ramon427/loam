import { Skeleton } from "../ui/Skeleton";
import { NoteDocumentFrame } from "./NoteDocumentFrame";
import { editorStyles as styles } from "../editor/blocknote/blockNoteStyles";

/** Reserve the same centered paper and canvas gutters as the loaded note. */
export function NoteDocumentSkeleton() {
  return (
    <NoteDocumentFrame
      mode="paper"
      tabs={
        <div aria-hidden="true" className="flex h-7 w-[108px] items-center gap-1.5 px-3">
          <Skeleton className="size-3.5" />
          <Skeleton className="h-3 w-14" />
        </div>
      }
    >
      <div
        data-notes-document-skeleton
        aria-hidden="true"
        className={`${styles.editorRoot} ${styles.notesEditorSwitchLoading} ${styles.notesDocumentSkeleton} space-y-8`}
      >
        <Skeleton className="h-8 w-3/5" />
        {[0, 1, 2].map((section) => (
          <div key={section} className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        ))}
      </div>
    </NoteDocumentFrame>
  );
}
