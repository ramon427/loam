import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { z } from "zod";

import {
  AI_PROVIDER_IDS,
  type AiAccessMode,
  type AiApprovalDecision,
  type AiAttachmentUpload,
  type AiChatConfigure,
  type AiChatContext,
  type AiChatEvent,
  type AiChatItem,
  type AiChatStatus,
  type AiKeyProviderId,
  type AiThread,
} from "@loam/shared/ai/aiChat";
import type { DataKey } from "@loam/storage/encryption/seal";
import { StoreError } from "@loam/storage/storeError";

import { createAttachmentStore } from "./attachments";
import { createChatMcp } from "./chatMcp";
import type { ChatTools } from "./chatTools";
import { contextLines, titleFrom } from "./prompt";
import { PROVIDERS } from "./providers/catalog";
import { transcribeSpeech } from "./providers/openai";
import { createProviderRegistry } from "./providers/registry";
import { loadAiSettings } from "./settings";
import { createThreadStore, type StoredThread } from "./threads";
import { createTurnRunner, type RunningTurn } from "./turn";

/**
 * The side chat: its settings, the saved chats, and the turns that run in
 * them. Turns run here, in the main process, so API keys never reach the
 * window; every note change goes through the same tools AI clients use, and
 * is checked against the chat's access mode before it runs.
 */
export const createAiService = async ({
  dataDirectory,
  plainTextKeys = false,
  version,
  chatTools,
  libraryKey,
  send,
}: {
  dataDirectory: string;
  /** Saves API keys even where the system can't encrypt them; for end-to-end tests. */
  plainTextKeys?: boolean;
  version: string;
  chatTools: ChatTools;
  /** The library's key while encryption is on; chats are sealed with it. */
  libraryKey: () => DataKey | null;
  send: {
    status: (status: AiChatStatus) => void;
    event: (event: AiChatEvent) => void;
  };
}) => {
  const settings = await loadAiSettings(dataDirectory, { plainTextKeys });
  const threads = createThreadStore({
    directory: join(dataDirectory, "ai-chats"),
    key: libraryKey,
  });
  const attachments = createAttachmentStore({
    directory: join(dataDirectory, "ai-chat-files"),
    key: libraryKey,
  });
  /** The library's key before it changes, which still opens the chats' files. */
  let previousKey: DataKey | null = null;
  const chatMcp = createChatMcp({ version });
  const providers = createProviderRegistry({ settings, chatMcp });
  const running = new Map<string, RunningTurn>();

  const status = async (): Promise<AiChatStatus> => {
    const current = settings.current();
    return {
      enabled: current.enabled,
      provider: current.provider,
      model: settings.model(),
      baseUrl: current.baseUrl,
      defaultMode: current.defaultMode,
      effort: current.effort,
      canDictate: settings.hasKey("openai"),
      providers: await Promise.all(AI_PROVIDER_IDS.map(providers.status)),
      error: settings.error(),
    };
  };
  const announce = async () => send.status(await status());

  const requireEnabled = () => {
    if (!settings.current().enabled)
      throw new StoreError("The side chat is off. Turn it on in Settings.", "FORBIDDEN", 403);
  };

  const summary = (thread: StoredThread) => ({
    id: thread.id,
    title: thread.title,
    updatedAt: thread.updatedAt,
    running: running.has(thread.id),
    mode: thread.mode,
    ...(thread.context ? { context: thread.context } : {}),
  });
  const publicThread = (thread: StoredThread): AiThread => {
    const { history: _history, undo: _undo, approved: _approved, ...rest } = thread;
    return { ...rest, running: running.has(thread.id) };
  };
  const emitItem = (thread: StoredThread, item: AiChatItem) => {
    threads.upsertItem(thread, item);
    send.event({ type: "item", threadId: thread.id, item });
  };
  const emitThread = (thread: StoredThread) =>
    send.event({ type: "thread", thread: summary(thread) });
  const emitThreads = async () =>
    send.event({ type: "threads", threads: await threads.list((id) => running.has(id)) });

  const runTurn = createTurnRunner({
    chatTools,
    providers,
    threads,
    attachments,
    effort: () => settings.current().effort,
    running,
    emitItem,
    emitThread,
    sendDelta: (delta) => send.event({ type: "delta", ...delta }),
  });

  const threadId = z.string().uuid();

  return {
    status,
    async configure(update: AiChatConfigure) {
      const { baseUrl } = settings.current();
      await settings.configure(update);
      if (settings.current().baseUrl !== baseUrl) providers.forgetModels("openai-compatible");
      const { provider } = settings.current();
      if (provider !== "anthropic" && PROVIDERS[provider].kind === "api-key")
        await providers.refreshModels(provider as AiKeyProviderId);
      if (update.enabled === false) for (const turn of running.values()) turn.controller.abort();
      await announce();
      return status();
    },
    /** Speech as text, through OpenAI's transcription with the saved key. */
    async transcribe(audio: Uint8Array, mimeType: string) {
      requireEnabled();
      const key = settings.key("openai");
      if (!key)
        throw new StoreError(
          "Add an OpenAI key in Settings › Side chat to dictate.",
          "FORBIDDEN",
          403,
        );
      return { text: await transcribeSpeech(key, audio, mimeType) };
    },
    async setKey(provider: AiKeyProviderId, key: string | null) {
      await settings.setKey(provider, key);
      providers.forgetModels(provider);
      await providers.refreshModels(provider);
      await announce();
      return status();
    },
    async list() {
      requireEnabled();
      return threads.list((id) => running.has(id));
    },
    async thread(id: string) {
      requireEnabled();
      return publicThread(await threads.get(threadId.parse(id)));
    },
    async send({
      threadId: id,
      text,
      context,
      mode,
      attachments: uploads = [],
    }: {
      threadId: string | null;
      text: string;
      context: AiChatContext | null;
      mode: AiAccessMode;
      attachments?: AiAttachmentUpload[];
    }) {
      requireEnabled();
      // Files a model can't read are refused before anything is saved.
      attachments.check(uploads);
      const current = settings.current();
      const thread = id
        ? await threads.get(id)
        : await threads.create({
            id: randomUUID(),
            mode,
            provider: current.provider,
            model: settings.model(),
          });
      if (running.has(thread.id))
        throw new StoreError("The assistant is still replying in this chat.", "CONFLICT", 409);
      // Each turn uses the provider and model chosen in Settings now.
      thread.provider = current.provider;
      thread.model = settings.model();
      thread.mode = mode;
      const files = await attachments.add(thread.id, uploads);
      if (thread.items.length === 0)
        thread.title = titleFrom(text || files.map((file) => file.name).join(", "));
      const turnId = randomUUID();
      emitItem(thread, {
        kind: "user",
        id: randomUUID(),
        turnId,
        text,
        context,
        ...(files.length > 0 ? { attachments: files } : {}),
        at: Date.now(),
      });
      const turn: RunningTurn = { controller: new AbortController(), approvals: new Map() };
      running.set(thread.id, turn);
      await threads.save(thread);
      emitThread(thread);
      await emitThreads();
      // A message of files alone still asks for something.
      const asked = text || "Look at the attached files.";
      void runTurn(thread, turnId, `${contextLines(context)}${asked}`, files, turn);
      return { threadId: thread.id };
    },
    stop(id: string) {
      running.get(id)?.controller.abort();
    },
    respond(id: string, approvalId: string, decision: AiApprovalDecision) {
      const resolve = running.get(id)?.approvals.get(approvalId);
      if (!resolve) throw new StoreError("That approval is no longer waiting.", "NOT_FOUND", 404);
      resolve(decision);
    },
    async undo(id: string, actionIds: string[]) {
      requireEnabled();
      const thread = await threads.get(id);
      for (const actionId of actionIds) {
        const record = thread.undo[actionId];
        const item = thread.items.find((entry) => entry.id === actionId);
        if (!record || item?.kind !== "action" || item.status !== "done") continue;
        await chatTools.undo(record);
        delete thread.undo[actionId];
        emitItem(thread, { ...item, status: "undone", undoable: false });
        await threads.save(thread);
      }
    },
    async setMode(id: string, mode: AiAccessMode) {
      const thread = await threads.get(id);
      thread.mode = mode;
      // Choosing a stricter mode takes back what was approved for the chat.
      if (mode === "supervised") thread.approved = [];
      await threads.save(thread);
      emitThread(thread);
    },
    async rename(id: string, title: string) {
      const thread = await threads.get(id);
      thread.title = title.trim().slice(0, 200) || thread.title;
      await threads.save(thread);
      emitThread(thread);
      await emitThreads();
    },
    async remove(id: string) {
      running.get(id)?.controller.abort();
      await threads.remove(id);
      await attachments.removeThread(id);
      await emitThreads();
    },
    /** A file sent in a chat, as it was attached. */
    async attachment(id: string, attachmentId: string) {
      requireEnabled();
      return attachments.bytes(threadId.parse(id), z.string().uuid().parse(attachmentId));
    },
    /** Before the library's key changes: reads every chat while the old key still opens it. */
    beforeKeyChange: async () => {
      previousKey = libraryKey();
      await threads.load();
    },
    /** After the key changed: saves every chat and its files again with the new key. */
    afterKeyChange: async () => {
      await threads.reseal();
      await attachments.reseal(previousKey);
      previousKey = null;
    },
    async close() {
      for (const turn of running.values()) turn.controller.abort();
      await chatMcp.close();
    },
  };
};

export type AiService = Awaited<ReturnType<typeof createAiService>>;
