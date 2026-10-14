import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import type {
  AiAccessMode,
  AiChatItem,
  AiProviderId,
  AiThread,
  AiThreadSummary,
  AiToolAccess,
} from "@loam/shared/ai/aiChat";
import { isSealedValue, openValue, sealValue, type DataKey } from "@loam/storage/encryption/seal";
import { StoreError } from "@loam/storage/storeError";

import { writeJsonFile } from "../jsonFiles";
import type { UndoRecord } from "./chatTools";

/**
 * How a provider continues a chat: the API's own messages, or the CLI's
 * session. Kept as the provider wrote it, so replies that carry reasoning
 * state are sent back unchanged.
 */
export type ProviderHistory = {
  provider: AiProviderId;
  model: string;
  messages?: unknown[];
  sessionId?: string;
};

/** A chat as saved: what the window shows, plus what continuing and undoing it need. */
export type StoredThread = Omit<AiThread, "running"> & {
  history: ProviderHistory | null;
  /** How to undo each action that changed something, by action id. */
  undo: Record<string, UndoRecord>;
  /** Kinds of change the user approved for the rest of this chat. */
  approved: AiToolAccess[];
};

const THREAD_FILE = /^([0-9a-f-]{36})\.json$/;
const sealContext = (threadId: string) => `ai-chat:${threadId}`;

/**
 * Saved chats, one private file each, in the data folder outside notes,
 * backups and sync. While the library is encrypted they are sealed with its
 * key; `reseal` rewrites them after the key changes.
 */
export const createThreadStore = ({
  directory,
  key,
}: {
  directory: string;
  /** The library's key while encryption is on. */
  key: () => DataKey | null;
}) => {
  let threads: Map<string, StoredThread> | null = null;

  const read = async (fileName: string): Promise<StoredThread | null> => {
    const id = THREAD_FILE.exec(fileName)?.[1];
    if (!id) return null;
    try {
      const value: unknown = JSON.parse(await readFile(join(directory, fileName), "utf8"));
      const current = key();
      const thread = isSealedValue(value)
        ? openValue(current ? [current] : [], value, sealContext(id))
        : value;
      return thread as StoredThread;
    } catch {
      // A chat sealed with a key this library no longer has can't be shown.
      return null;
    }
  };

  const write = async (thread: StoredThread) => {
    await mkdir(directory, { recursive: true });
    const current = key();
    await writeJsonFile(
      join(directory, `${thread.id}.json`),
      current ? sealValue(current, thread, sealContext(thread.id)) : thread,
      { private: true },
    );
  };

  const all = async () => {
    if (threads) return threads;
    const loaded = new Map<string, StoredThread>();
    const names = await readdir(directory).catch(() => [] as string[]);
    for (const name of names) {
      const thread = await read(name);
      if (thread) loaded.set(thread.id, thread);
    }
    threads = loaded;
    return loaded;
  };

  const get = async (threadId: string) => {
    const thread = (await all()).get(threadId);
    if (!thread) throw new StoreError("That chat no longer exists.", "NOT_FOUND", 404);
    return thread;
  };

  return {
    async list(running: (threadId: string) => boolean): Promise<AiThreadSummary[]> {
      return [...(await all()).values()]
        .map(({ id, title, updatedAt }) => ({ id, title, updatedAt, running: running(id) }))
        .sort((left, right) => right.updatedAt - left.updatedAt);
    },
    get,
    async create({
      id,
      mode,
      provider,
      model,
    }: {
      id: string;
      mode: AiAccessMode;
      provider: AiProviderId;
      model: string;
    }) {
      const now = Date.now();
      const thread: StoredThread = {
        id,
        title: "New chat",
        createdAt: now,
        updatedAt: now,
        mode,
        provider,
        model,
        items: [],
        history: null,
        undo: {},
        approved: [],
      };
      (await all()).set(id, thread);
      return thread;
    },
    /** Saves a chat after it changed. */
    async save(thread: StoredThread) {
      thread.updatedAt = Date.now();
      await write(thread);
    },
    /** Replaces an item by id, or adds it at the end. */
    upsertItem(thread: StoredThread, item: AiChatItem) {
      const index = thread.items.findIndex((entry) => entry.id === item.id);
      if (index === -1) thread.items.push(item);
      else thread.items[index] = item;
    },
    async remove(threadId: string) {
      (await all()).delete(threadId);
      await rm(join(directory, `${threadId}.json`), { force: true });
    },
    /** Reads every chat while the current key still opens them, before the key changes. */
    load: () => all().then(() => undefined),
    /** Writes every chat again with the library's current key. */
    async reseal() {
      for (const thread of (await all()).values()) await write(thread);
    },
    /** Forgets chats read with a key, when the library locks or closes. */
    clear() {
      threads = null;
    },
  };
};
