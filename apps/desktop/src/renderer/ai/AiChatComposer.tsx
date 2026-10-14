import { useId, useRef, useState } from "react";
import {
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  FileTextIcon,
  ListChecksIcon,
  PaperclipIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";

import { AI_ACCESS_MODES, type AiChatContext, type AiChatStatus } from "@loam/shared/ai/aiChat";

import { Button } from "../ui/Button";
import { cn } from "../ui/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/DropdownMenu";
import { Textarea } from "../ui/Textarea";

import { ACCESS_MODES, PLAN_MODE } from "./accessModes";
import styles from "./aiChat.module.css";
import { AiChatContextMeter } from "./AiChatContextMeter";
import { AiChatDictation } from "./AiChatDictation";
import { AiChatEffortPicker, AiChatModelPicker } from "./AiChatModelPicker";
import { useNoteMentions, type MentionableNote } from "./useNoteMentions";
import { usePromptQueue } from "./usePromptQueue";
import {
  ATTACHMENT_ACCEPT,
  PASTE_AS_FILE_CHARS,
  PendingAttachmentChips,
  type usePendingAttachments,
} from "./AiChatAttachments";
import { AiChatMentionMenu } from "./AiChatMentionMenu";
import { AiChatPromptQueue } from "./AiChatPromptQueue";
import type { AiChat } from "./useAiChat";

type PendingAttachments = ReturnType<typeof usePendingAttachments>;

/** The most selected text sent along with a message. */
const MAX_SELECTION_LENGTH = 4000;

export type ActiveNote = { id: string; title: string };

/** Text selected in the open note, if the selection is there. */
const readNoteSelection = () => {
  const selection = window.getSelection();
  const main = document.getElementById("main-content");
  if (!selection || !main || !selection.anchorNode || !main.contains(selection.anchorNode))
    return null;
  const text = selection.toString().trim();
  return text ? text.slice(0, MAX_SELECTION_LENGTH) : null;
};

/** Where the user writes to the assistant, with how much it may do and what it sees. */
export function AiChatComposer({
  chat,
  activeNote,
  disabled,
  draft,
  onDraftChange,
  attachments,
  status,
  notes,
}: {
  chat: AiChat;
  activeNote: ActiveNote | null;
  disabled: boolean;
  draft: string;
  onDraftChange: (text: string) => void;
  /** The files the message carries; dropping files on the chat adds them too. */
  attachments: PendingAttachments;
  status: AiChatStatus;
  /** The notes @ can name. */
  notes: readonly MentionableNote[];
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mentions = useNoteMentions(notes);
  const queue = usePromptQueue(chat);
  const menuId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [selection, setSelection] = useState<string | null>(null);
  // The note the user took out of the context; another open note comes back in.
  const [droppedNoteId, setDroppedNoteId] = useState<string | null>(null);
  const contextNote = activeNote && activeNote.id !== droppedNoteId ? activeNote : null;
  const mode = ACCESS_MODES[chat.mode];
  // While a reply runs, a message waits its turn.
  const canSend =
    !disabled && attachments.ready && (draft.trim().length > 0 || attachments.pending.length > 0);

  const resize = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    // scrollHeight leaves out the border; without it the box scrolls by a pixel or two.
    const border = textarea.offsetHeight - textarea.clientHeight;
    textarea.style.height = `${textarea.scrollHeight + border}px`;
  };

  const send = () => {
    if (!canSend) return;
    const named = mentions.mentionsIn(draft);
    const context: AiChatContext | null =
      contextNote || named.length > 0
        ? {
            noteId: contextNote?.id ?? null,
            noteTitle: contextNote?.title ?? null,
            selection: contextNote ? selection : null,
            ...(named.length > 0 ? { mentions: named } : {}),
          }
        : null;
    const files = attachments.take();
    if (!files) return;
    if (chat.running) queue.add({ text: draft.trim(), context, attachments: files });
    else void chat.send(draft.trim(), context, { attachments: files });
    onDraftChange("");
    setSelection(null);
    mentions.reset();
    requestAnimationFrame(resize);
  };

  const pick = (note: MentionableNote) => {
    const next = mentions.choose(note, draft);
    if (!next) return;
    onDraftChange(next.text);
    requestAnimationFrame(() => {
      textareaRef.current?.setSelectionRange(next.caret, next.caret);
      resize();
    });
  };

  /** The last message sent in this chat, to bring back with ↑. */
  const lastSent = () => {
    for (const item of chat.thread?.items.toReversed() ?? [])
      if (item.kind === "user" && item.text) return item.text;
    return null;
  };

  return (
    <form
      className="@container/composer flex flex-none flex-col gap-2 border-t border-(--app-border-subtle) p-3"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      {contextNote ? (
        <div className="flex min-w-0 items-center gap-1 self-start rounded-full border border-(--app-border-subtle) py-0.5 pr-0.5 pl-2 text-[11px] text-(--app-muted)">
          <FileTextIcon className="size-3 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">
            Using: {contextNote.title || "Untitled"}
            {selection ? " (selection)" : ""}
          </span>
          <Button
            size="icon-xs"
            variant="ghost-muted"
            className="size-5"
            aria-label="Don't use this note"
            onClick={() => {
              setDroppedNoteId(contextNote.id);
              setSelection(null);
            }}
          >
            <XIcon aria-hidden />
          </Button>
        </div>
      ) : null}
      {queue.queue.length > 0 ? (
        <AiChatPromptQueue
          prompts={queue.queue}
          onSendNow={queue.sendNow}
          onEdit={(prompt) => {
            queue.remove(prompt.key);
            onDraftChange(prompt.text);
            requestAnimationFrame(() => {
              textareaRef.current?.focus();
              resize();
            });
          }}
          onRemove={queue.remove}
        />
      ) : null}
      <PendingAttachmentChips pending={attachments.pending} onRemove={attachments.remove} />
      {mentions.open ? (
        <AiChatMentionMenu
          id={menuId}
          matches={mentions.matches}
          highlight={mentions.highlight}
          onPick={pick}
        />
      ) : null}
      <Textarea
        ref={textareaRef}
        aria-label="Message"
        placeholder={
          disabled
            ? "Set up a provider to chat"
            : chat.running
              ? "Write the next message; it waits for this reply"
              : "Ask anything"
        }
        rows={1}
        className="max-h-60 min-h-9 resize-none text-[13px]"
        value={draft}
        disabled={disabled}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={mentions.open}
        aria-controls={mentions.open ? menuId : undefined}
        aria-activedescendant={mentions.open ? `${menuId}-${mentions.highlight}` : undefined}
        onFocus={() => {
          if (contextNote) setSelection(readNoteSelection());
        }}
        onChange={(event) => {
          onDraftChange(event.target.value);
          mentions.track(event.target.value, event.target.selectionStart);
          resize();
        }}
        onSelect={(event) =>
          mentions.track(event.currentTarget.value, event.currentTarget.selectionStart)
        }
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (mentions.onKey(event.key, pick)) {
            event.preventDefault();
            return;
          }
          // Escape stops a reply that is running.
          if (event.key === "Escape" && chat.running) {
            event.preventDefault();
            chat.stop();
            return;
          }
          // ↑ in an empty message brings back the last one sent, to send again or change.
          if (event.key === "ArrowUp" && !draft) {
            const last = lastSent();
            if (last) {
              event.preventDefault();
              onDraftChange(last);
              requestAnimationFrame(resize);
            }
            return;
          }
          if (event.key !== "Enter" || event.shiftKey) return;
          event.preventDefault();
          send();
        }}
        onPaste={(event) => {
          // A screenshot or copied file goes with the message; a long text, as a file of its own.
          const files = [...event.clipboardData.files];
          const text = event.clipboardData.getData("text/plain");
          if (files.length > 0) {
            event.preventDefault();
            attachments.add(files);
          } else if (text.length > PASTE_AS_FILE_CHARS) {
            event.preventDefault();
            attachments.add([new File([text], "Pasted text.txt", { type: "text/plain" })]);
          }
        }}
      />
      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        accept={ATTACHMENT_ACCEPT}
        onChange={(event) => {
          attachments.add([...(event.target.files ?? [])]);
          event.target.value = "";
        }}
      />
      <div className="flex min-w-0 items-center gap-1">
        {status.canDictate ? (
          <AiChatDictation
            disabled={disabled}
            onText={(spoken) => {
              onDraftChange(draft ? `${draft.trimEnd()} ${spoken}` : spoken);
              requestAnimationFrame(() => {
                textareaRef.current?.focus();
                resize();
              });
            }}
          />
        ) : null}
        <Button
          variant="ghost-muted"
          size="icon-sm"
          aria-label="Attach files"
          disabled={disabled}
          onClick={() => fileRef.current?.click()}
        >
          <PaperclipIcon aria-hidden />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost-muted"
              size="sm"
              className="min-w-0 px-2"
              aria-label={`Access: ${mode.label}`}
              disabled={disabled}
            >
              <mode.icon aria-hidden />
              {/* A narrow chat keeps the icons; the names show as tooltips. */}
              <span className="truncate @max-[26rem]/composer:hidden">{mode.label}</span>
              <ChevronDownIcon aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            {AI_ACCESS_MODES.map((id) => {
              const option = ACCESS_MODES[id];
              return (
                <DropdownMenuItem
                  key={id}
                  className="items-start"
                  onSelect={() => chat.changeMode({ mode: id, plan: chat.plan })}
                >
                  <option.icon className="mt-0.5 size-3.5" aria-hidden />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span>{option.label}</span>
                    <span className="text-[11px] text-(--app-muted)">{option.description}</span>
                  </span>
                  <CheckIcon
                    className={cn("mt-0.5 size-3.5", id !== chat.mode && "invisible")}
                    aria-hidden
                  />
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost-muted"
          size="sm"
          className={cn("min-w-0 px-2", chat.plan && "bg-(--app-surface-2) text-(--app-text)")}
          aria-pressed={chat.plan}
          aria-label={PLAN_MODE.label}
          title={PLAN_MODE.description}
          disabled={disabled}
          onClick={() => chat.changeMode({ mode: chat.mode, plan: !chat.plan })}
        >
          <ListChecksIcon aria-hidden />
          <span className="@max-[26rem]/composer:hidden">{PLAN_MODE.label}</span>
        </Button>
        <span className="flex-1" />
        {chat.thread?.context ? <AiChatContextMeter usage={chat.thread.context} /> : null}
        <AiChatModelPicker status={status} disabled={disabled} />
        <span aria-hidden className="h-4 w-px shrink-0 bg-(--app-border)" />
        <AiChatEffortPicker status={status} disabled={disabled} />
        {chat.running ? (
          <Button
            size="icon-sm"
            variant="outline"
            aria-label="Stop"
            title="Stop (Esc)"
            className={styles.swapIn}
            onClick={chat.stop}
          >
            <SquareIcon className="fill-current" aria-hidden />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon-sm"
            aria-label="Send"
            title="Send"
            className={styles.swapIn}
            disabled={!canSend}
          >
            <ArrowUpIcon aria-hidden />
          </Button>
        )}
      </div>
    </form>
  );
}
