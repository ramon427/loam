import { createContext, use, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  FileTextIcon,
  GlobeIcon,
  ListChecksIcon,
  MessageSquareIcon,
  PencilIcon,
  SquarePenIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

import type { AiChatStatus } from "@loam/shared/ai/aiChat";

import { ShortcutHint } from "../keyboard/ShortcutHint";
import { Button } from "../ui/Button";
import { cn } from "../ui/cn";
import { DestructiveConfirmDialog } from "../ui/DestructiveConfirmDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/DropdownMenu";
import { EmptyState } from "../ui/EmptyState";
import { Input } from "../ui/Input";
import { Notice } from "../ui/Notice";

import { usePendingAttachments } from "./AiChatAttachments";
import { AiChatComposer, type ActiveNote } from "./AiChatComposer";
import type { MentionableNote } from "./useNoteMentions";
import { AiChatMessages } from "./AiChatMessages";
import styles from "./aiChat.module.css";
import { useAiChat, type AiChat } from "./useAiChat";
import { PANEL_ID, type AiChatLayout } from "./useAiChatLayout";

/** Each card names the task briefly and puts its full request in the message box. */
const STARTERS = [
  { title: "Summarize", detail: "This note", text: "Summarize this note", icon: FileTextIcon },
  {
    title: "Checklist",
    detail: "From this note",
    text: "Turn this note into a checklist",
    icon: ListChecksIcon,
  },
  {
    title: "Research",
    detail: "From the web",
    text: "Research this topic and add what you find",
    icon: GlobeIcon,
  },
];

/** How long the chat's column takes to close; it stays until then. */
const CLOSE_MS = 260;

const ToggleContext = createContext<{ open: boolean; onOpen: () => void } | null>(null);

/** Lets the screen headers open the side chat while it is on. */
export const AiChatToggleProvider = ToggleContext.Provider;

/** Opens the side chat; nothing while it is off or already open. */
export function AiChatOpenButton() {
  const toggle = use(ToggleContext);
  if (!toggle || toggle.open) return null;
  return (
    <ShortcutHint label="Open side chat" shortcut="app.chat.toggle">
      <Button
        variant="ghost-muted"
        size="icon-sm"
        aria-label="Open side chat"
        aria-controls={PANEL_ID}
        aria-expanded={false}
        onClick={toggle.onOpen}
      >
        <MessageSquareIcon aria-hidden />
      </Button>
    </ShortcutHint>
  );
}

/**
 * The side chat's column at the window's right edge and the seam that
 * resizes it. Its chats stay loaded while it is closed.
 */
export function AiChatSide({
  layout,
  status,
  activeNote,
  notes = [],
  onOpenNote,
  onOpenSettings,
}: {
  layout: AiChatLayout;
  status: AiChatStatus;
  activeNote: ActiveNote | null;
  /** The notes the message can name with @. */
  notes?: readonly MentionableNote[];
  onOpenNote: (noteId: string) => void;
  onOpenSettings: () => void;
}) {
  const chat = useAiChat(status.defaultMode);
  const [draft, setDraft] = useState("");
  const attachments = usePendingAttachments();
  const [dragging, setDragging] = useState(false);
  // A closing chat stays while its column slides shut, so it leaves rather than vanishes.
  const [shownOpen, setShownOpen] = useState(layout.open);
  const [closing, setClosing] = useState(false);
  if (shownOpen !== layout.open) {
    setShownOpen(layout.open);
    setClosing(!layout.open);
  }
  useEffect(() => {
    if (!closing) return;
    const done = setTimeout(() => setClosing(false), CLOSE_MS);
    return () => clearTimeout(done);
  }, [closing]);
  if (!layout.open && !closing) return null;
  const provider = status.providers.find((candidate) => candidate.id === status.provider);
  const ready = Boolean(provider?.ready);
  const thread = chat.thread;

  let body: ReactNode;
  if (!ready)
    body = (
      <EmptyState
        className="flex-1"
        title="Set up the side chat"
        description={
          provider?.detail ??
          "Choose a provider and add an API key, or use a CLI you're signed in to."
        }
        action={
          <Button size="sm" variant="outline" onClick={onOpenSettings}>
            Open Settings
          </Button>
        }
      />
    );
  else if (chat.loading) body = <div className="flex-1" aria-busy="true" />;
  else if (thread && thread.items.length > 0)
    body = (
      <AiChatMessages
        // Each chat starts with what it holds at rest; only what arrives after rises in.
        key={thread.id}
        thread={thread}
        model={status.model}
        onAskAgain={(message) => void chat.send(message.text, message.context)}
        threadId={thread.id}
        onOpenNote={onOpenNote}
        onRespond={chat.respond}
        onUndo={chat.undo}
      />
    );
  else
    body = (
      <div className="flex flex-1 flex-col justify-end gap-2.5 px-4 pt-4 pb-2">
        <p className={cn("mb-1 text-[13px] text-(--app-secondary-label)", styles.riseIn)}>
          Ask anything. It can search the web, use a browser, and read and change your notes.
        </p>
        <div className="grid grid-cols-3 gap-2">
          {STARTERS.map((starter, index) => (
            <button
              key={starter.text}
              type="button"
              aria-label={starter.text}
              className={cn(
                "flex min-w-0 cursor-pointer flex-col items-start gap-3 rounded-[14px] border border-(--app-border) bg-(--chat-composer-bg) p-3 text-left shadow-[0_1px_2px_rgb(0_0_0/4%)] transition-colors duration-(--control-transition-duration) hover:border-(--app-border-strong) hover:bg-(--app-surface-2) focus-visible:outline-2 focus-visible:outline-(--app-focus-ring)",
                styles.riseIn,
              )}
              style={{ animationDelay: `${40 + index * 35}ms` }}
              onClick={() => {
                setDraft(starter.text);
                document.getElementById(PANEL_ID)?.querySelector("textarea")?.focus();
              }}
            >
              <starter.icon
                className="size-[18px] shrink-0 text-(--app-secondary-label)"
                strokeWidth={1.75}
                aria-hidden
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-[13px] font-medium text-(--app-text)">
                  {starter.title}
                </span>
                <span className="text-[12px] leading-snug text-(--app-secondary-label)">
                  {starter.detail}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    );

  return (
    <>
      {closing ? null : (
        <div
          className={styles.resize}
          data-resizing={layout.resizing}
          {...layout.resizeHandleProps}
        />
      )}
      <aside
        id={PANEL_ID}
        className={cn(styles.panel, dragging && styles.dropping)}
        aria-label="Side chat"
        inert={closing}
        // Files dropped on the chat go with the next message, not into the note behind it.
        data-takes-file-drops=""
        onDragOver={(event) => {
          if (!ready || !event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(event) => {
          setDragging(false);
          if (!ready || event.dataTransfer.files.length === 0) return;
          event.preventDefault();
          attachments.add([...event.dataTransfer.files]);
        }}
        // Its content keeps the chat's width while the column opens or closes around it.
        style={{ "--loam-chat-content-width": `${layout.width}px` } as CSSProperties}
      >
        <ChatHeader chat={chat} onClose={layout.close} />
        {body}
        {chat.error ? (
          <Notice tone="danger" className="mx-3 mb-2">
            {chat.error}
          </Notice>
        ) : null}
        <AiChatComposer
          chat={chat}
          activeNote={activeNote}
          disabled={!ready}
          draft={draft}
          onDraftChange={setDraft}
          attachments={attachments}
          status={status}
          notes={notes}
          onOpenSettings={onOpenSettings}
        />
      </aside>
    </>
  );
}

function ChatHeader({ chat, onClose }: { chat: AiChat; onClose: () => void }) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const activeId = chat.activeId;
  const title = chat.thread?.title ?? "New chat";
  const recent = chat.threads ?? [];

  const finishRename = (save: boolean) => {
    const next = renaming?.trim();
    if (save && activeId && next && next !== title) chat.rename(activeId, next);
    setRenaming(null);
  };

  return (
    <header className={cn("loam-chrome-row", styles.header)}>
      {renaming !== null ? (
        <Input
          aria-label="Chat name"
          className="h-7 min-w-0 flex-1"
          autoFocus
          value={renaming}
          onChange={(event) => setRenaming(event.target.value)}
          onBlur={() => finishRename(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              finishRename(false);
            }
          }}
        />
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-[30px] min-w-0 flex-1 justify-start px-2 text-[14px] text-(--app-text)"
              aria-label={`Chats: ${title}`}
            >
              <span className="min-w-0 truncate">{title}</span>
              <ChevronDownIcon aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel>Recent chats</DropdownMenuLabel>
            {recent.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-(--app-muted)">No saved chats yet.</p>
            ) : (
              recent.map((summary) => (
                <DropdownMenuItem key={summary.id} onSelect={() => chat.selectThread(summary.id)}>
                  <span className="min-w-0 flex-1 truncate">{summary.title}</span>
                  {summary.running ? (
                    <span className="text-[11px] text-(--app-muted)">Working…</span>
                  ) : null}
                  <CheckIcon
                    className={cn("size-3.5", summary.id !== activeId && "invisible")}
                    aria-hidden
                  />
                </DropdownMenuItem>
              ))
            )}
            {/* The header sits under the window's own buttons, so the chat's actions live here. */}
            {activeId ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setRenaming(title)}>
                  <PencilIcon aria-hidden />
                  Rename chat
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
                  <Trash2Icon aria-hidden />
                  Delete chat
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Button
        variant="ghost-muted"
        size="icon-sm"
        aria-label="New chat"
        title="New chat"
        disabled={!activeId}
        onClick={() => chat.selectThread(null)}
      >
        <SquarePenIcon aria-hidden />
      </Button>
      <ShortcutHint label="Close side chat" shortcut="app.chat.toggle">
        <Button variant="ghost-muted" size="icon-sm" aria-label="Close side chat" onClick={onClose}>
          <XIcon aria-hidden />
        </Button>
      </ShortcutHint>
      {activeId ? (
        <DestructiveConfirmDialog
          open={deleting}
          onOpenChange={setDeleting}
          title="Delete this chat?"
          target={title}
          currentState="A saved chat"
          nextState="Gone from your chats"
          blastRadius="Only the conversation. Changes it made to notes stay."
          confirmLabel="Delete chat"
          onConfirm={() => {
            setDeleting(false);
            chat.remove(activeId);
          }}
        />
      ) : null}
    </header>
  );
}
