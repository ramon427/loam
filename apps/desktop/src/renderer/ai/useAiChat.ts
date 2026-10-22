import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AiAccessMode,
  AiApprovalDecision,
  AiAttachmentUpload,
  AiChatContext,
  AiChatEvent,
  AiChatItem,
  AiContextUsage,
  AiThreadSummary,
} from "@loam/shared/ai/aiChat";

import { callBridge, onBridgeEvent } from "../bridge";
import { errorMessage } from "@loam/notes-ui/lib/errorMessage";

/** A chat as the window shows it. */
export type ChatThread = {
  id: string;
  title: string;
  running: boolean;
  mode: AiAccessMode;
  items: AiChatItem[];
  /** How long each turn that finished while the window watched took, by turn id. */
  durations: Record<string, number>;
  /** How full the model's context is with the chat, once a turn has said. */
  context?: AiContextUsage;
  /**
   * Whether `items` holds the whole chat. Events for a chat that isn't loaded
   * start it with only what they carry; opening it reads the rest.
   */
  complete: boolean;
};

type Threads = Record<string, ChatThread>;

const NEW_CHAT_TITLE = "New chat";

const upsertItem = (items: AiChatItem[], item: AiChatItem) => {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index === -1) return [...items, item];
  const next = items.slice();
  next[index] = item;
  return next;
};

/**
 * Joins a chat read from the store with what events brought meanwhile: an
 * answer still streaming keeps the longer text, and items the read missed
 * stay at the end.
 */
const mergeItems = (stored: AiChatItem[], local: AiChatItem[]) => {
  const localById = new Map(local.map((item) => [item.id, item]));
  const merged = stored.map((item) => {
    const mine = localById.get(item.id);
    return mine?.kind === "assistant" &&
      item.kind === "assistant" &&
      mine.text.length > item.text.length
      ? mine
      : item;
  });
  const storedIds = new Set(stored.map((item) => item.id));
  return [...merged, ...local.filter((item) => !storedIds.has(item.id))];
};

/** The chat's durations with its last turn's, from when its message was sent to `now`. */
const withFinishedTurn = (thread: ChatThread, now: number) => {
  const sent = thread.items.findLast((item) => item.kind === "user");
  return sent?.kind === "user"
    ? { ...thread.durations, [sent.turnId]: now - sent.at }
    : thread.durations;
};

const applyEvent = (threads: Threads, event: AiChatEvent, fallbackMode: AiAccessMode): Threads => {
  const placeholder = (id: string): ChatThread => ({
    id,
    title: NEW_CHAT_TITLE,
    running: true,
    mode: fallbackMode,
    items: [],
    durations: {},
    complete: false,
  });
  switch (event.type) {
    case "item": {
      const thread = threads[event.threadId] ?? placeholder(event.threadId);
      return {
        ...threads,
        [thread.id]: { ...thread, items: upsertItem(thread.items, event.item) },
      };
    }
    case "delta": {
      const thread = threads[event.threadId];
      if (!thread) return threads;
      const items = thread.items.map((item) =>
        item.id === event.itemId && item.kind === "assistant"
          ? { ...item, text: item.text + event.text }
          : item,
      );
      return { ...threads, [thread.id]: { ...thread, items } };
    }
    case "thread": {
      const { id, title, running, mode, context } = event.thread;
      const thread = threads[id] ?? placeholder(id);
      const durations =
        thread.running && !running ? withFinishedTurn(thread, Date.now()) : thread.durations;
      return {
        ...threads,
        [id]: {
          ...thread,
          title,
          running,
          mode,
          durations,
          context: context ?? thread.context,
        },
      };
    }
    case "threads":
      return threads;
  }
};

const sortSummaries = (summaries: AiThreadSummary[]) =>
  summaries.toSorted((a, b) => b.updatedAt - a.updatedAt);

/**
 * The side chat's conversations: the list of chats, the open one, and what
 * the main process streams into them. A null active chat is a new one that
 * starts with the first message.
 */
export function useAiChat(defaultMode: AiAccessMode) {
  const [summaries, setSummaries] = useState<AiThreadSummary[] | null>(null);
  const [threads, setThreads] = useState<Threads>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draftMode, setDraftMode] = useState<AiAccessMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const defaultModeRef = useRef(defaultMode);
  useEffect(() => {
    defaultModeRef.current = defaultMode;
  }, [defaultMode]);

  useEffect(() => {
    let current = true;
    callBridge("ai.threads", {})
      .then((list) => current && setSummaries(sortSummaries(list)))
      .catch((reason: unknown) => current && setError(errorMessage(reason)));
    const stopEvents = onBridgeEvent("ai.event", (event) => {
      if (event.type === "threads") setSummaries(sortSummaries(event.threads));
      if (event.type === "thread") {
        const { id, title, updatedAt, running } = event.thread;
        setSummaries((list) =>
          sortSummaries([
            { id, title, updatedAt, running },
            ...(list ?? []).filter((summary) => summary.id !== id),
          ]),
        );
      }
      setThreads((current) => applyEvent(current, event, defaultModeRef.current));
    });
    return () => {
      current = false;
      stopEvents();
    };
  }, []);

  const active = activeId ? threads[activeId] : undefined;
  const needsLoad = Boolean(activeId) && !active?.complete;
  useEffect(() => {
    if (!activeId || !needsLoad) return;
    let current = true;
    callBridge("ai.thread", { threadId: activeId })
      .then((stored) => {
        if (!current) return;
        setThreads((all) => ({
          ...all,
          [stored.id]: {
            id: stored.id,
            title: stored.title,
            running: stored.running,
            mode: stored.mode,
            items: mergeItems(stored.items, all[stored.id]?.items ?? []),
            durations: all[stored.id]?.durations ?? {},
            context: all[stored.id]?.context ?? stored.context,
            complete: true,
          },
        }));
      })
      .catch((reason: unknown) => current && setError(errorMessage(reason)));
    return () => {
      current = false;
    };
  }, [activeId, needsLoad]);

  const run = useCallback(async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }, []);

  const mode = active?.mode ?? draftMode ?? defaultMode;

  const selectThread = useCallback((threadId: string | null) => {
    setError(null);
    setActiveId(threadId);
    if (!threadId) setDraftMode(null);
  }, []);

  const send = useCallback(
    async (
      text: string,
      context: AiChatContext | null,
      options?: { attachments?: AiAttachmentUpload[] },
    ) => {
      setSending(true);
      await run(async () => {
        const { threadId } = await callBridge("ai.send", {
          threadId: activeId,
          text,
          context,
          mode,
          ...(options?.attachments?.length ? { attachments: options.attachments } : {}),
        });
        if (activeId) return;
        // A new chat has nothing stored beyond what its events bring.
        setThreads((all) => ({
          ...all,
          [threadId]: {
            ...(all[threadId] ?? {
              id: threadId,
              title: NEW_CHAT_TITLE,
              running: true,
              items: [],
              durations: {},
            }),
            mode,
            complete: true,
          },
        }));
        setActiveId(threadId);
      });
      setSending(false);
    },
    [activeId, mode, run],
  );

  const changeMode = useCallback(
    (next: AiAccessMode) => {
      if (!activeId) {
        setDraftMode(next);
        return;
      }
      setThreads((all) => {
        const thread = all[activeId];
        return thread ? { ...all, [activeId]: { ...thread, mode: next } } : all;
      });
      void run(() => callBridge("ai.setMode", { threadId: activeId, mode: next }));
    },
    [activeId, run],
  );

  const forActive = useCallback(
    (work: (threadId: string) => Promise<unknown>) => {
      if (activeId) void run(() => work(activeId));
    },
    [activeId, run],
  );

  return {
    threads: summaries,
    activeId,
    thread: active?.complete ? active : null,
    loading: needsLoad,
    running: Boolean(active?.running) || sending,
    mode,
    error,
    selectThread,
    send,
    changeMode,
    stop: useCallback(
      () => forActive((threadId) => callBridge("ai.stop", { threadId })),
      [forActive],
    ),
    respond: useCallback(
      (approvalId: string, decision: AiApprovalDecision) =>
        forActive((threadId) => callBridge("ai.respond", { threadId, approvalId, decision })),
      [forActive],
    ),
    undo: useCallback(
      (actionIds: string[]) =>
        forActive((threadId) => callBridge("ai.undo", { threadId, actionIds })),
      [forActive],
    ),
    rename: useCallback(
      (threadId: string, title: string) => {
        setSummaries(
          (list) =>
            list?.map((summary) => (summary.id === threadId ? { ...summary, title } : summary)) ??
            null,
        );
        setThreads((all) =>
          all[threadId] ? { ...all, [threadId]: { ...all[threadId], title } } : all,
        );
        void run(() => callBridge("ai.renameThread", { threadId, title }));
      },
      [run],
    ),
    remove: useCallback(
      (threadId: string) =>
        void run(async () => {
          await callBridge("ai.deleteThread", { threadId });
          setSummaries((list) => list?.filter((summary) => summary.id !== threadId) ?? null);
          setActiveId((current) => (current === threadId ? null : current));
        }),
      [run],
    ),
  };
}

export type AiChat = ReturnType<typeof useAiChat>;
