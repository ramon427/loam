import { useEffect, useRef, useState, type ReactNode } from "react";
import { FileIcon, FileTextIcon, XIcon } from "lucide-react";

import {
  MAX_AI_ATTACHMENTS,
  MAX_AI_IMAGE_ATTACHMENTS,
  type AiAttachment,
  type AiAttachmentUpload,
} from "@loam/shared/ai/aiChat";

import { callBridge } from "../bridge";
import { Button } from "@loam/notes-ui/ui/Button";
import { cn } from "@loam/notes-ui/ui/cn";
import { DotMatrixLoader } from "@loam/notes-ui/ui/DotMatrixLoader";
import { toastError } from "@loam/notes-ui/ui/toast";

import styles from "./aiChat.module.css";

/** The files the picker offers; anything else that is text can still be dropped or pasted. */
export const ATTACHMENT_ACCEPT =
  "image/png,image/jpeg,image/gif,image/webp,.pdf,.docx,.txt,.md,.markdown,.csv,.json,.log,.html,.xml,.yaml,.yml";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 32 * 1024 * 1024;
const MAX_TEXT_CHARS = 1_000_000;
/** Pasted text longer than this goes as a file, so the message stays readable. */
export const PASTE_AS_FILE_CHARS = 4000;

type Kind = AiAttachment["kind"];

const kindOf = (file: File): Kind | "docx" =>
  file.type.startsWith("image/")
    ? "image"
    : file.type === "application/pdf" || /\.pdf$/i.test(file.name)
      ? "pdf"
      : /\.docx$/i.test(file.name)
        ? "docx"
        : "text";

/** A file the message will carry: while its text is read, then ready to send. */
export type PendingAttachment = {
  key: string;
  name: string;
  kind: Kind;
  size: number;
  previewUrl: string | null;
  upload: AiAttachmentUpload | null;
};

const formatSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Reads what a file says, for models that can't read the file itself. */
const readFile = async (file: File, kind: Kind | "docx"): Promise<AiAttachmentUpload> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text: string | null = null;
  if (kind === "pdf")
    text = await import("@loam/notes-ui/files/pdfjs")
      .then(({ readPdfText }) => readPdfText(bytes, MAX_TEXT_CHARS))
      .catch(() => null);
  if (kind === "docx")
    text = await import("@loam/notes-ui/files/docxText").then(({ readDocxText }) =>
      readDocxText(bytes, MAX_TEXT_CHARS),
    );
  return { name: file.name, bytes, text };
};

/** Why a file can't go with the message, or null when it can. */
const refusal = (file: File, kind: Kind | "docx", pending: readonly PendingAttachment[]) => {
  if (pending.length >= MAX_AI_ATTACHMENTS)
    return `A message carries at most ${MAX_AI_ATTACHMENTS} files.`;
  if (kind === "image") {
    if (pending.filter((entry) => entry.kind === "image").length >= MAX_AI_IMAGE_ATTACHMENTS)
      return `A message carries at most ${MAX_AI_IMAGE_ATTACHMENTS} images.`;
    if (file.size > MAX_IMAGE_BYTES)
      return `"${file.name}" is over 5MB; models take images up to 5MB.`;
  }
  if (kind === "pdf" && file.size > MAX_PDF_BYTES) return `"${file.name}" is over 32MB.`;
  if ((kind === "text" || kind === "docx") && file.size > 4 * MAX_TEXT_CHARS)
    return `"${file.name}" is too long to send.`;
  return null;
};

/**
 * The files the next message carries. Each is read as it is added (a PDF's
 * or Word document's text, for models that can't read the file); the
 * message can go once every file is ready.
 */
export function usePendingAttachments() {
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const latest = useRef(pending);
  useEffect(() => {
    latest.current = pending;
  });
  // Previews made for files still waiting go when the composer does.
  useEffect(
    () => () => {
      for (const entry of latest.current)
        if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
    },
    [],
  );

  const remove = (key: string) =>
    setPending((current) => {
      const gone = current.find((entry) => entry.key === key);
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      return current.filter((entry) => entry.key !== key);
    });

  const add = (files: readonly File[]) => {
    const accepted: { entry: PendingAttachment; file: File; kind: Kind | "docx" }[] = [];
    for (const file of files) {
      const kind = kindOf(file);
      const problem = refusal(file, kind, [
        ...latest.current,
        ...accepted.map(({ entry }) => entry),
      ]);
      if (problem) {
        toastError(problem);
        continue;
      }
      accepted.push({
        file,
        kind,
        entry: {
          key: crypto.randomUUID(),
          name: file.name,
          kind: kind === "docx" ? "text" : kind,
          size: file.size,
          previewUrl: kind === "image" ? URL.createObjectURL(file) : null,
          upload: null,
        },
      });
    }
    if (accepted.length === 0) return;
    setPending((current) => [...current, ...accepted.map(({ entry }) => entry)]);
    for (const { entry, file, kind } of accepted)
      readFile(file, kind).then(
        (upload) =>
          setPending((current) =>
            current.map((candidate) =>
              candidate.key === entry.key ? { ...candidate, upload } : candidate,
            ),
          ),
        () => {
          toastError(`"${file.name}" couldn't be read.`);
          remove(entry.key);
        },
      );
  };

  /** The files to send, emptying the list; null while one is still being read. */
  const take = (): AiAttachmentUpload[] | null => {
    if (latest.current.some((entry) => !entry.upload)) return null;
    const uploads = latest.current.map((entry) => entry.upload!);
    for (const entry of latest.current) if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
    setPending([]);
    return uploads;
  };

  return {
    pending,
    ready: pending.every((entry) => entry.upload),
    add,
    remove,
    take,
  };
}

/** A sent file's image, read back from the chat to show it. */
function SentImage({ threadId, attachment }: { threadId: string; attachment: AiAttachment }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let current: string | null = null;
    let active = true;
    callBridge("ai.attachment", { threadId, attachmentId: attachment.id }).then(
      (bytes) => {
        if (!active) return;
        current = URL.createObjectURL(new Blob([bytes.slice()], { type: attachment.mimeType }));
        setUrl(current);
      },
      () => undefined,
    );
    return () => {
      active = false;
      if (current) URL.revokeObjectURL(current);
    };
  }, [threadId, attachment.id, attachment.mimeType]);
  return url ? <img src={url} alt="" className="size-full object-cover" /> : null;
}

/** One file with a message: its picture or icon, its name and size, and (while composing) a way to take it out. */
function Chip({
  name,
  kind,
  size,
  image,
  reading,
  onRemove,
}: {
  name: string;
  kind: Kind;
  size: number;
  image: ReactNode;
  reading?: boolean;
  onRemove?: () => void;
}) {
  const Icon = kind === "text" ? FileTextIcon : FileIcon;
  return (
    <li
      className={cn(
        "group relative flex h-10 max-w-52 min-w-0 items-center gap-2 rounded-(--radius-control) border border-(--app-border-subtle) bg-(--app-surface) pr-2 text-[11px]",
        kind === "image" ? "pl-0" : "pl-2",
        styles.riseIn,
        styles.fast,
      )}
      title={name}
    >
      {kind === "image" ? (
        <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-l-(--radius-control) bg-(--app-surface-2)">
          {image}
        </span>
      ) : (
        <Icon className="size-4 shrink-0 text-(--app-muted)" aria-hidden />
      )}
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-(--app-text)">{name}</span>
        <span className="text-(--app-muted)">
          {reading ? "Reading…" : kind === "pdf" ? `PDF · ${formatSize(size)}` : formatSize(size)}
        </span>
      </span>
      {reading ? <DotMatrixLoader className="text-(--app-muted)" /> : null}
      {onRemove ? (
        <Button
          size="icon-xs"
          variant="secondary"
          aria-label={`Remove ${name}`}
          className={cn(
            "absolute -top-2 -right-2 size-5 rounded-full shadow-sm",
            styles.revealOnHover,
          )}
          onClick={onRemove}
        >
          <XIcon aria-hidden />
        </Button>
      ) : null}
    </li>
  );
}

/** The files the next message carries, above where it is written. */
export function PendingAttachmentChips({
  pending,
  onRemove,
}: {
  pending: readonly PendingAttachment[];
  onRemove: (key: string) => void;
}) {
  if (pending.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2 pt-1" aria-label="Files to send">
      {pending.map((entry) => (
        <Chip
          key={entry.key}
          name={entry.name}
          kind={entry.kind}
          size={entry.size}
          reading={!entry.upload}
          image={
            entry.previewUrl ? (
              <img src={entry.previewUrl} alt="" className="size-full object-cover" />
            ) : null
          }
          onRemove={() => onRemove(entry.key)}
        />
      ))}
    </ul>
  );
}

/** The files a sent message carried. */
export function SentAttachmentChips({
  threadId,
  attachments,
}: {
  threadId: string;
  attachments: readonly AiAttachment[];
}) {
  return (
    <ul className="flex flex-wrap justify-end gap-2" aria-label="Files sent">
      {attachments.map((attachment) => (
        <Chip
          key={attachment.id}
          name={attachment.name}
          kind={attachment.kind}
          size={attachment.size}
          image={<SentImage threadId={threadId} attachment={attachment} />}
        />
      ))}
    </ul>
  );
}
