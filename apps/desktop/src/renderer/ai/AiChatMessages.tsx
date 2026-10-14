import { useEffect, useRef, useState, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowDownIcon,
  CheckIcon,
  ChevronRightIcon,
  EyeIcon,
  FilePlusIcon,
  FolderInputIcon,
  GlobeIcon,
  MousePointerClickIcon,
  PencilIcon,
  RotateCcwIcon,
  SearchIcon,
  TerminalIcon,
  Trash2Icon,
  Undo2Icon,
  XIcon,
} from "lucide-react";

import type { AiApprovalDecision, AiChatItem } from "@loam/shared/ai/aiChat";
import { readNoteHrefNoteId } from "@loam/shared/notes/noteLinks";

import { Button } from "../ui/Button";
import { cn } from "../ui/cn";
import { CopyButton } from "../ui/CopyButton";
import { DotMatrixLoader } from "../ui/DotMatrixLoader";
import { Notice } from "../ui/Notice";

import { SentAttachmentChips } from "./AiChatAttachments";
import styles from "./aiChat.module.css";
import { useFollowLatest } from "./useFollowLatest";
import type { ChatThread } from "./useAiChat";

type ActionItem = Extract<AiChatItem, { kind: "action" }>;
type ApprovalItem = Extract<AiChatItem, { kind: "approval" }>;
type UserItem = Extract<AiChatItem, { kind: "user" }>;
type AssistantItem = Extract<AiChatItem, { kind: "assistant" }>;

type ChatHandlers = {
  /** The chat the messages are in, to show the files they carried. */
  threadId: string;
  onOpenNote: (noteId: string) => void;
  onRespond: (approvalId: string, decision: AiApprovalDecision) => void;
  onUndo: (actionIds: string[]) => void;
  onImplementPlan: () => void;
  /** Sends a message again, for a new answer to it. */
  onAskAgain: (message: UserItem) => void;
};

/** How long a turn works before its elapsed time shows. */
const SHOW_ELAPSED_AFTER_MS = 8000;

/**
 * The chat's items in order, following the newest while the user stays at
 * the bottom. What was there when the chat opened shows as it is; what
 * arrives after rises in.
 */
export function AiChatMessages({
  thread,
  model,
  ...handlers
}: { thread: ChatThread; model: string } & ChatHandlers) {
  const { scrollRef, contentRef, onScroll, behind, backToLatest } = useFollowLatest();
  // Items already there when the chat showed: they don't animate, nor on later renders.
  const [settled] = useState(() => new Set(thread.items.map((item) => item.id)));
  const turns = groupTurns(thread.items);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 [overflow-anchor:none]"
        onScroll={onScroll}
      >
        <ol ref={contentRef} className="flex flex-col gap-3" aria-label="Messages">
          {turns.map((turn, index) => {
            const latest = index === turns.length - 1;
            return (
              <Turn
                key={turn.id}
                items={turn.items}
                running={thread.running && latest}
                latest={latest}
                duration={thread.durations[turn.id]}
                model={model}
                settled={settled}
                {...handlers}
              />
            );
          })}
        </ol>
      </div>
      {behind ? (
        <Button
          size="sm"
          variant="outline"
          className={cn(
            "absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full shadow-md",
            styles.riseIn,
            styles.fast,
          )}
          onClick={backToLatest}
        >
          <ArrowDownIcon aria-hidden />
          Back to latest
        </Button>
      ) : null}
    </div>
  );
}

const groupTurns = (items: AiChatItem[]) => {
  const turns: { id: string; items: AiChatItem[] }[] = [];
  for (const item of items) {
    const last = turns.at(-1);
    if (last?.id === item.turnId) last.items.push(item);
    else turns.push({ id: item.turnId, items: [item] });
  }
  return turns;
};

/** Runs of reads one after another show as one row; everything else stands alone. */
const groupReads = (items: AiChatItem[]) => {
  const groups: (AiChatItem | ActionItem[])[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    const reads = item.kind === "action" && (item.access === "read" || item.access === "web");
    if (reads && item.status !== "failed") {
      if (Array.isArray(last)) last.push(item);
      else groups.push([item]);
    } else groups.push(item);
  }
  return groups.map((group) => (Array.isArray(group) && group.length === 1 ? group[0]! : group));
};

/** The steps a turn took on its way to the answer: what it did and what it asked. */
const isStep = (item: AiChatItem) =>
  item.kind === "action" || (item.kind === "approval" && item.status !== "pending");

/** "32s", "2m 5s". */
const formatDuration = (ms: number) => {
  const seconds = Math.max(1, Math.round(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

function Turn({
  items,
  running,
  latest,
  duration,
  model,
  settled,
  threadId,
  onOpenNote,
  onRespond,
  onUndo,
  onImplementPlan,
  onAskAgain,
}: {
  items: AiChatItem[];
  running: boolean;
  latest: boolean;
  duration: number | undefined;
  model: string;
  settled: Set<string>;
} & ChatHandlers) {
  const undoable = items
    .filter((item): item is ActionItem => item.kind === "action")
    .filter((action) => action.undoable && action.status === "done")
    .map((action) => action.id)
    .reverse();
  const message = items.find((item): item is UserItem => item.kind === "user");
  const answers = items.filter((item): item is AssistantItem => item.kind === "assistant");
  const steps = items.filter(isStep);
  const enter = (item: AiChatItem, fast = false) =>
    settled.has(item.id) ? undefined : cn(styles.riseIn, fast && styles.fast);
  const row = (item: AiChatItem | ActionItem[]) =>
    Array.isArray(item) ? (
      <li key={item[0]!.id} className={enter(item[0]!)}>
        <ReadGroup actions={item} onOpenNote={onOpenNote} />
      </li>
    ) : (
      <li key={item.id} className={enter(item, item.kind === "user")}>
        <Item
          item={item}
          threadId={threadId}
          onOpenNote={onOpenNote}
          onRespond={onRespond}
          onUndo={onUndo}
        />
      </li>
    );

  // While a turn works, its steps show as they happen; once done they fold away above the answer.
  const folded = !running && steps.length > 0;
  const rest = folded ? items.filter((item) => !isStep(item)) : items;
  const last = items.at(-1);
  const thinking =
    running &&
    !(last?.kind === "assistant" && last.text) &&
    !(last?.kind === "action" && last.status === "running") &&
    !(last?.kind === "approval" && last.status === "pending");
  const answerText = answers.map((answer) => answer.text).join("\n\n");
  // A reply that failed can be asked for again, as long as nothing has to be sent twice.
  const failed = items.some((item) => item.kind === "error");
  const askable = latest && message && !message.attachments?.length ? message : null;

  return (
    <>
      {message ? row(message) : null}
      {folded ? (
        <li className={enter(steps[0]!)}>
          <WorkedFor steps={steps} duration={duration} onOpenNote={onOpenNote} onUndo={onUndo} />
        </li>
      ) : null}
      {groupReads(rest.filter((item) => item !== message)).map(row)}
      {thinking ? (
        <li>
          <Thinking since={message?.at} model={model} />
        </li>
      ) : null}
      {!running && failed && askable ? (
        <li>
          <Button size="sm" variant="outline" onClick={() => onAskAgain(askable)}>
            <RotateCcwIcon aria-hidden />
            Try again
          </Button>
        </li>
      ) : null}
      {!running && answerText ? (
        <li className="-mt-2 flex items-center gap-0.5">
          <CopyButton label="Copy answer" text={() => answerText} />
          {/* Files aren't sent twice; a message with them is asked again by sending them. */}
          {askable && !failed ? (
            <Button
              size="icon-xs"
              variant="ghost-muted"
              aria-label="Ask again"
              onClick={() => onAskAgain(askable)}
            >
              <RotateCcwIcon aria-hidden />
            </Button>
          ) : null}
        </li>
      ) : null}
      {!running && (undoable.length > 0 || (message?.plan && latest)) ? (
        <li className="flex flex-wrap gap-2">
          {message?.plan && latest ? (
            <Button size="sm" variant="outline" onClick={onImplementPlan}>
              Implement plan
            </Button>
          ) : null}
          {undoable.length > 0 ? (
            <Button size="sm" variant="ghost-muted" onClick={() => onUndo(undoable)}>
              <Undo2Icon aria-hidden />
              Undo all changes from this reply
            </Button>
          ) : null}
        </li>
      ) : null}
    </>
  );
}

/** The model at work before anything shows: a shimmering word, then how long it has taken. */
function Thinking({ since, model }: { since: number | undefined; model: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);
  const elapsed = since ? now - since : 0;
  return (
    <div className="flex items-center gap-2 px-1 text-xs" role="status">
      <DotMatrixLoader className="text-(--app-muted)" />
      <span className={styles.shimmer}>Thinking</span>
      {elapsed >= SHOW_ELAPSED_AFTER_MS ? (
        <span className="text-(--app-muted) tabular-nums">
          · {formatDuration(elapsed)}
          {model ? ` · ${model}` : ""}
        </span>
      ) : null}
    </div>
  );
}

/** A finished turn's steps, folded into one line that opens to show them. */
function WorkedFor({
  steps,
  duration,
  onOpenNote,
  onUndo,
}: {
  steps: AiChatItem[];
  duration: number | undefined;
  onOpenNote: (noteId: string) => void;
  onUndo: (actionIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const failed = steps.filter((step) => step.kind === "action" && step.status === "failed").length;
  const count = `${steps.length} ${steps.length === 1 ? "step" : "steps"}`;
  const summary = duration ? `Worked for ${formatDuration(duration)} · ${count}` : count;
  return (
    <div>
      <Button
        variant="ghost-muted"
        size="sm"
        className="-ml-1 min-w-0 px-1"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <ChevronRightIcon className={cn(styles.chevron, open && "rotate-90")} aria-hidden />
        {summary}
        {failed > 0 ? <span className="text-(--status-danger)">· {failed} failed</span> : null}
      </Button>
      {open ? (
        <ol className={cn("ml-2 border-l border-(--app-border-subtle) pl-2", styles.softIn)}>
          {groupReads(steps).map((step) =>
            Array.isArray(step) ? (
              <li key={step[0]!.id}>
                <ReadGroup actions={step} onOpenNote={onOpenNote} />
              </li>
            ) : (
              <li key={step.id}>
                <Item
                  item={step}
                  threadId=""
                  onOpenNote={onOpenNote}
                  onRespond={() => {}}
                  onUndo={onUndo}
                />
              </li>
            ),
          )}
        </ol>
      ) : null}
    </div>
  );
}

function Item({
  item,
  threadId,
  onOpenNote,
  onRespond,
  onUndo,
}: { item: AiChatItem } & Pick<ChatHandlers, "threadId" | "onOpenNote" | "onRespond" | "onUndo">) {
  switch (item.kind) {
    case "user":
      return <UserMessage item={item} threadId={threadId} />;
    case "assistant":
      return (
        <div className={cn(styles.markdown, item.streaming && styles.streaming)}>
          <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents(onOpenNote)}>
            {item.text}
          </Markdown>
          {item.streaming ? <span className="sr-only">Writing…</span> : null}
        </div>
      );
    case "action":
      return <ActionRow action={item} onOpenNote={onOpenNote} onUndo={onUndo} />;
    case "approval":
      return <ApprovalCard approval={item} onRespond={onRespond} />;
    case "error":
      return <Notice tone="danger">{item.message}</Notice>;
  }
}

function UserMessage({ item, threadId }: { item: UserItem; threadId: string }) {
  const context = item.context;
  const chips = [
    context?.noteTitle ?? null,
    context?.selection ? "Selection" : null,
    item.plan ? "Plan" : null,
  ].filter((chip): chip is string => Boolean(chip));
  return (
    <div className="ml-6 flex flex-col items-end gap-1">
      {item.attachments?.length ? (
        <SentAttachmentChips threadId={threadId} attachments={item.attachments} />
      ) : null}
      {item.text ? (
        <div className="rounded-(--radius-control) bg-(--app-surface-2) px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap text-(--app-text)">
          {item.text}
        </div>
      ) : null}
      {chips.length > 0 ? (
        <div className="flex flex-wrap justify-end gap-1">
          {chips.map((chip) => (
            <span
              key={chip}
              className="max-w-48 truncate rounded-full border border-(--app-border-subtle) px-2 text-[11px] text-(--app-muted)"
            >
              {chip}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Links to notes open them here; other links open in the browser. Code blocks can be copied. */
const markdownComponents = (onOpenNote: (noteId: string) => void): Components => ({
  a: ({ href, children }) => {
    const noteId = readNoteHrefNoteId(href, window.location.origin);
    if (noteId)
      return (
        <a
          href={href}
          onClick={(event) => {
            event.preventDefault();
            onOpenNote(noteId);
          }}
        >
          {children}
        </a>
      );
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  },
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
});

function CodeBlock({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  return (
    <div className={styles.codeBlock}>
      <pre ref={ref}>{children}</pre>
      <CopyButton
        label="Copy code"
        className={styles.codeCopy}
        text={() => ref.current?.textContent ?? ""}
      />
    </div>
  );
}

/** What an action does at a glance: looks, browses, edits, adds, moves, deletes or acts outside Loam. */
function ActionIcon({ action }: { action: Pick<ActionItem, "access" | "tool"> }) {
  const className = "size-3.5 shrink-0";
  if (action.access === "read" || action.access === "web") {
    if (/search|find|grep|glob/i.test(action.tool))
      return <SearchIcon className={className} aria-hidden />;
    if (/browser|web|fetch/i.test(action.tool))
      return <GlobeIcon className={className} aria-hidden />;
    return <EyeIcon className={className} aria-hidden />;
  }
  if (action.access === "outside")
    return /bash|command/i.test(action.tool) ? (
      <TerminalIcon className={className} aria-hidden />
    ) : (
      <MousePointerClickIcon className={className} aria-hidden />
    );
  if (action.access === "edit") return <PencilIcon className={className} aria-hidden />;
  if (/delete|trash|remove/i.test(action.tool))
    return <Trash2Icon className={className} aria-hidden />;
  if (/create|new|add/i.test(action.tool))
    return <FilePlusIcon className={className} aria-hidden />;
  return <FolderInputIcon className={className} aria-hidden />;
}

function ActionRow({
  action,
  onOpenNote,
  onUndo,
}: {
  action: ActionItem;
  onOpenNote: (noteId: string) => void;
  onUndo: (actionIds: string[]) => void;
}) {
  const undone = action.status === "undone";
  const failed = action.status === "failed";
  const running = action.status === "running";
  const label: ReactNode = (
    <span
      className={cn("min-w-0 flex-1 truncate", undone && "line-through", running && styles.shimmer)}
    >
      {action.label}
    </span>
  );
  return (
    <div className="group flex flex-col gap-0.5">
      <div
        className={cn(
          "flex min-h-7 items-center gap-2 rounded-(--radius-control) px-1 text-xs text-(--app-muted)",
          failed && "text-(--status-danger)",
        )}
      >
        {running ? <DotMatrixLoader label="Running" /> : <ActionIcon action={action} />}
        {action.noteId ? (
          <button
            type="button"
            className="flex min-w-0 flex-1 cursor-pointer text-left hover:text-(--app-text)"
            onClick={() => onOpenNote(action.noteId!)}
          >
            {label}
          </button>
        ) : (
          label
        )}
        {undone ? <span className="shrink-0">Undone</span> : null}
        {action.status === "declined" ? <span className="shrink-0">Declined</span> : null}
        {action.undoable && action.status === "done" ? (
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label={`Undo: ${action.label}`}
            title="Undo"
            className={styles.revealOnHover}
            onClick={() => onUndo([action.id])}
          >
            <Undo2Icon aria-hidden />
          </Button>
        ) : null}
      </div>
      {failed && action.error ? (
        <p className="pl-6 text-xs text-(--status-danger)">{action.error}</p>
      ) : null}
    </div>
  );
}

function ReadGroup({
  actions,
  onOpenNote,
}: {
  actions: ActionItem[];
  onOpenNote: (noteId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const running = actions.some((action) => action.status === "running");
  const noteCount = actions.filter((action) => action.noteId).length;
  const summary =
    noteCount === actions.length
      ? `Read ${noteCount} notes`
      : `Looked things up (${actions.length} steps)`;
  return (
    <div>
      <Button
        variant="ghost-muted"
        size="sm"
        className="-ml-1 min-w-0 px-1"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {running ? (
          <DotMatrixLoader label="Running" />
        ) : (
          <ChevronRightIcon className={cn(styles.chevron, open && "rotate-90")} aria-hidden />
        )}
        <span className={cn(running && styles.shimmer)}>{summary}</span>
      </Button>
      {open ? (
        <div className={cn("pl-4", styles.softIn)}>
          {actions.map((action) => (
            <ActionRow key={action.id} action={action} onOpenNote={onOpenNote} onUndo={() => {}} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

const DECISIONS: { decision: AiApprovalDecision; label: string }[] = [
  { decision: "accept", label: "Accept" },
  { decision: "accept-for-chat", label: "Accept for this chat" },
  { decision: "decline", label: "Decline" },
];

function ApprovalCard({
  approval,
  onRespond,
}: {
  approval: ApprovalItem;
  onRespond: (approvalId: string, decision: AiApprovalDecision) => void;
}) {
  if (approval.status !== "pending")
    return (
      <div className="flex items-center gap-2 px-1 text-xs text-(--app-muted)">
        {approval.status === "accepted" ? (
          <CheckIcon className="size-3.5 shrink-0" aria-hidden />
        ) : (
          <XIcon className="size-3.5 shrink-0" aria-hidden />
        )}
        <span className="min-w-0 truncate">
          {approval.status === "accepted" ? "Accepted" : "Declined"}: {approval.label}
        </span>
      </div>
    );
  return (
    <section
      aria-label="Approval"
      className="flex flex-col gap-2 rounded-(--radius-control) border border-(--app-border) p-3"
    >
      <p className="text-[13px] font-medium text-(--app-text)">{approval.label}</p>
      {approval.access === "outside" ? (
        <p className="text-xs text-(--app-muted)">
          This happens outside Loam and can&apos;t be undone from the chat.
        </p>
      ) : null}
      {approval.preview ? (
        <pre className={styles.preview}>
          {approval.preview.split("\n").map((line, index) => (
            <span
              // Lines of a preview never reorder.
              key={index}
              className={cn(
                line.startsWith("+") && styles.added,
                line.startsWith("-") && styles.removed,
              )}
            >
              {line}
              {"\n"}
            </span>
          ))}
        </pre>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {DECISIONS.map(({ decision, label }) => (
          <Button
            key={decision}
            size="sm"
            variant={decision === "accept" ? "default" : "outline"}
            onClick={() => onRespond(approval.id, decision)}
          >
            {label}
          </Button>
        ))}
      </div>
    </section>
  );
}
