import { useState } from "react";
import { BookmarkPlusIcon, XIcon } from "lucide-react";

import type { BridgeLinkedFile } from "@loam/shared/bridge/loamBridge";

import { NoteHeader } from "../note/NoteHeader";
import { NoteLayout } from "../note/NoteLayout";
import { Button } from "../ui/Button";
import { FileTab } from "./FileTab";

/**
 * A file opened from outside the notes, shown over the open note. It stays
 * where it is on this computer; keeping it as a reference makes a note that
 * links to it, and closing it leaves the notes as they were.
 */
export function OpenedFileView({
  opened,
  onKeep,
  onClose,
}: {
  opened: BridgeLinkedFile;
  onKeep: (opened: BridgeLinkedFile) => void;
  onClose: () => void;
}) {
  // What the viewer changes, such as the page a PDF is at, goes into the note if it is kept.
  const [file, setFile] = useState(opened.file);

  return (
    <section
      aria-label={`Opened file ${file.name}`}
      className="absolute inset-0 z-10 flex flex-col bg-(--app-page)"
    >
      <NoteLayout
        header={
          <NoteHeader
            title={<h1 className="truncate px-[13px] text-base font-medium">{file.name}</h1>}
            actions={
              <>
                <Button size="sm" onClick={() => onKeep({ kind: opened.kind, file })}>
                  <BookmarkPlusIcon />
                  Keep as reference
                </Button>
                <Button variant="ghost" size="sm" onClick={onClose}>
                  <XIcon />
                  Close
                </Button>
              </>
            }
          />
        }
      >
        <div className="mx-auto w-full max-w-5xl px-6 pt-4">
          <div className="overflow-hidden rounded-(--radius-control) border border-(--app-border) bg-(--app-surface)">
            <FileTab kind={opened.kind} file={file} onChangeFile={setFile} />
          </div>
        </div>
      </NoteLayout>
    </section>
  );
}
