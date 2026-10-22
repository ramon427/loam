import { lazy, Suspense, useEffect, useEffectEvent, useRef, useState } from "react";
import { ExternalLinkIcon, HardDriveDownloadIcon } from "lucide-react";

import type { FileTabKind, NoteFile } from "@loam/shared/notes/noteModel";

import { callBridge, onBridgeEvent } from "../host/notesHost";
import { NoteEditorSwitchLoading } from "../note/NoteEditorSwitchLoading";
import { TAB_KINDS, TabKindIcon } from "../note/tabKinds";
import { Button } from "../ui/Button";
import { Notice } from "../ui/Notice";
import { toastError } from "../ui/toast";
import { useTabFile } from "./useTabFile";

const PdfViewer = lazy(() => import("./PdfViewer"));
const DocxViewer = lazy(() => import("./DocxViewer"));
const MarkdownEditor = lazy(() => import("./MarkdownEditor"));

/** How long typing in a linked Markdown file pauses before it is written. */
const MARKDOWN_WRITE_DELAY_MS = 500;

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

/** Where a tab's file is, in words. */
const describeSource = ({ source }: NoteFile) =>
  source.kind === "referenced" ? source.path : "In your notes";

/**
 * A file tab: the file's name and where it is, with what can be done with
 * it, above the file itself. `onChangeFile` keeps what changes in the note:
 * a Markdown file's text, the page a PDF is at, or the file a copy became.
 */
export function FileTab({
  kind,
  file,
  onChangeFile,
}: {
  kind: FileTabKind;
  file: NoteFile | undefined;
  onChangeFile: (file: NoteFile) => void;
}) {
  if (!file)
    return (
      <p className="py-16 text-center text-sm text-(--app-muted)">This tab's file is missing.</p>
    );
  return (
    // A file scrolls inside the tab, which fills the window below the note's title and tabs.
    <div className="flex h-[max(34rem,calc(100dvh-9rem))] flex-col">
      <FileHeader kind={kind} file={file} onChangeFile={onChangeFile} />
      <div className="min-h-0 flex-1">
        <Suspense fallback={<NoteEditorSwitchLoading label={TAB_KINDS[kind].loadingLabel} />}>
          {kind === "markdown" && file.source.kind === "text" ? (
            <MarkdownEditor
              text={file.source.text}
              onChange={(text) => onChangeFile({ ...file, source: { kind: "text", text } })}
            />
          ) : kind === "markdown" ? (
            <LinkedMarkdown file={file} />
          ) : (
            <FileViewer kind={kind} file={file} onChangeFile={onChangeFile} />
          )}
        </Suspense>
      </div>
    </div>
  );
}

function FileHeader({
  kind,
  file,
  onChangeFile,
}: {
  kind: FileTabKind;
  file: NoteFile;
  onChangeFile: (file: NoteFile) => void;
}) {
  const [openedCopy, setOpenedCopy] = useState<string | null>(null);
  const latestFile = useEffectEvent(() => file);
  const keepChanged = useEffectEvent((next: NoteFile) => onChangeFile(next));

  // A library file opened in another app comes back into the tab each time that app saves it.
  useEffect(() => {
    if (!openedCopy) return;
    void callBridge("files.watch", { kind, path: openedCopy }).catch(() => undefined);
    const stop = onBridgeEvent("files.changed", ({ path }) => {
      if (path !== openedCopy) return;
      const current = latestFile();
      callBridge("files.takeBackCopy", { kind, path, name: current.name }).then(
        (taken) => keepChanged({ ...taken, ...(current.page ? { page: current.page } : {}) }),
        (error: unknown) => toastError(errorMessage(error, "Couldn't read the edited file.")),
      );
    });
    return () => {
      stop();
      void callBridge("files.unwatch", { path: openedCopy }).catch(() => undefined);
    };
  }, [kind, openedCopy]);

  const openExternally = async () => {
    try {
      const { path } = await callBridge("files.openExternally", { kind, file });
      if (file.source.kind !== "referenced") setOpenedCopy(path);
    } catch (error) {
      toastError(errorMessage(error, "Couldn't open the file."));
    }
  };

  const copyIn = async () => {
    try {
      onChangeFile({ ...(await callBridge("files.copyIn", { kind, file })), name: file.name });
    } catch (error) {
      toastError(errorMessage(error, "Couldn't copy the file into your notes."));
    }
  };

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-(--app-border) px-3 py-1.5">
      <TabKindIcon kind={kind} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-(--app-text)">{file.name}</p>
        <p className="truncate text-[11px] text-(--app-muted)" title={describeSource(file)}>
          {describeSource(file)}
        </p>
      </div>
      {file.source.kind === "referenced" ? (
        <Button variant="ghost" size="sm" onClick={() => void copyIn()}>
          <HardDriveDownloadIcon />
          Copy into notes
        </Button>
      ) : null}
      <Button variant="ghost" size="sm" onClick={() => void openExternally()}>
        <ExternalLinkIcon />
        {kind === "docx" ? "Open in Word" : "Open in another app"}
      </Button>
    </div>
  );
}

/** A PDF or Word document, read through the main process. */
function FileViewer({
  kind,
  file,
  onChangeFile,
}: {
  kind: "pdf" | "docx" | "markdown";
  file: NoteFile;
  onChangeFile: (file: NoteFile) => void;
}) {
  const state = useTabFile(kind, file);

  if (state.status === "loading")
    return <NoteEditorSwitchLoading label={TAB_KINDS[kind].loadingLabel} />;
  if (state.status === "missing") return <MissingFile file={file} message={state.message} />;
  if (kind === "docx") return <DocxViewer bytes={state.bytes} />;
  return (
    <PdfViewer
      bytes={state.bytes}
      initialPage={file.page}
      onPageChange={(page) => onChangeFile({ ...file, page })}
    />
  );
}

function MissingFile({ file, message }: { file: NoteFile; message: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-1 py-16 text-center">
      <p className="text-sm text-(--app-text)">{message}</p>
      {file.source.kind === "referenced" ? (
        <p className="text-xs text-(--app-muted)">
          This tab links to a file where it was added. Copy a file into your notes to have it on
          every computer.
        </p>
      ) : null}
    </div>
  );
}

const decodeText = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

const writeLinkedMarkdown = (file: NoteFile, text: string) =>
  callBridge("files.writeMarkdown", { file, text }).catch((error: unknown) =>
    toastError(errorMessage(error, "Couldn't save the file.")),
  );

/**
 * A Markdown file linked where it is: edits are written to it, and changes
 * made to it elsewhere show here. If it changes on disk while an edit is
 * waiting to be written, the tab asks which to keep.
 */
function LinkedMarkdown({ file }: { file: NoteFile }) {
  const state = useTabFile("markdown", file);
  const [text, setText] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const written = useRef<string | null>(null);
  const pending = useRef<number | undefined>(undefined);
  const latest = useRef({ file, text });
  useEffect(() => {
    latest.current = { file, text };
  });

  const write = (next: string) => {
    written.current = next;
    void writeLinkedMarkdown(latest.current.file, next);
  };

  useEffect(() => {
    if (state.status !== "ready") return;
    const onDisk = decodeText(state.bytes);
    if (onDisk === written.current) return;
    if (pending.current === undefined) setText(onDisk);
    else setConflict(onDisk);
  }, [state]);

  // An edit still waiting when the tab closes is written then.
  useEffect(
    () => () => {
      window.clearTimeout(pending.current);
      const { file: closing, text: unsaved } = latest.current;
      if (pending.current !== undefined && unsaved !== null)
        void writeLinkedMarkdown(closing, unsaved);
    },
    [],
  );

  if (state.status === "loading" || (state.status === "ready" && text === null))
    return <NoteEditorSwitchLoading label={TAB_KINDS.markdown.loadingLabel} />;
  if (state.status === "missing") return <MissingFile file={file} message={state.message} />;

  return (
    <div className="flex h-full flex-col">
      {conflict !== null ? (
        <Notice tone="warning" role="status" className="m-3 flex items-center gap-2">
          This file changed on disk while you were editing it.{" "}
          <Button
            variant="link"
            size="sm"
            onClick={() => {
              window.clearTimeout(pending.current);
              pending.current = undefined;
              setText(conflict);
              setConflict(null);
            }}
          >
            Use the file on disk
          </Button>{" "}
          <Button
            variant="link"
            size="sm"
            onClick={() => {
              setConflict(null);
              if (text !== null) write(text);
            }}
          >
            Keep my edits
          </Button>
        </Notice>
      ) : null}
      <div className="min-h-0 flex-1">
        <MarkdownEditor
          text={text ?? ""}
          onChange={(next) => {
            if (next === text) return;
            setText(next);
            window.clearTimeout(pending.current);
            pending.current = window.setTimeout(() => {
              pending.current = undefined;
              write(next);
            }, MARKDOWN_WRITE_DELAY_MS);
          }}
        />
      </div>
    </div>
  );
}
