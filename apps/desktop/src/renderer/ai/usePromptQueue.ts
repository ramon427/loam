import { useEffect, useRef, useState } from "react";

import type { AiAttachmentUpload, AiChatContext } from "@loam/shared/ai/aiChat";

import type { AiChat } from "./useAiChat";

export type QueuedPrompt = {
  key: string;
  text: string;
  context: AiChatContext | null;
  attachments: AiAttachmentUpload[];
};

/**
 * Messages written while a reply is still running. Each waits its turn and
 * goes when the chat is free; "send now" stops the reply so it goes at once.
 * A chat's queue stays with it: switching chats leaves it behind.
 */
export function usePromptQueue(chat: AiChat) {
  const [queue, setQueue] = useState<QueuedPrompt[]>([]);
  const [queueChat, setQueueChat] = useState(chat.activeId);
  if (queueChat !== chat.activeId) {
    setQueueChat(chat.activeId);
    // A new chat getting its id is still the same chat; another chat opened leaves the queue behind.
    if (queueChat !== null) setQueue([]);
  }

  const next = !chat.running && queue.length > 0 ? queue[0]! : null;
  // A message goes once, however often the effect runs before the queue catches up.
  const sent = useRef(new Set<string>());
  useEffect(() => {
    if (!next || sent.current.has(next.key)) return;
    sent.current.add(next.key);
    setQueue((current) => current.filter((entry) => entry.key !== next.key));
    void chat.send(next.text, next.context, { attachments: next.attachments });
  }, [chat, next]);

  return {
    queue,
    add: (prompt: Omit<QueuedPrompt, "key">) => {
      setQueue((current) => [...current, { ...prompt, key: crypto.randomUUID() }]);
    },
    remove: (key: string) => setQueue((current) => current.filter((entry) => entry.key !== key)),
    /** Stops the running reply, and sends this message first once it has stopped. */
    sendNow: (key: string) => {
      setQueue((current) => [
        ...current.filter((entry) => entry.key === key),
        ...current.filter((entry) => entry.key !== key),
      ]);
      chat.stop();
    },
  };
}
