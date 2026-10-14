import { randomUUID } from "node:crypto";

import type {
  AiAccessMode,
  AiApprovalDecision,
  AiAttachment,
  AiChatItem,
  AiEffort,
  AiToolAccess,
} from "@loam/shared/ai/aiChat";
import { StoreError } from "@loam/storage/storeError";

import { toBridgeFailure } from "../requests/dispatch";
import type { createAttachmentStore } from "./attachments";
import type { ChatTool, ChatTools } from "./chatTools";
import { systemPrompt, transcriptOf } from "./prompt";
import { contextWindowOf } from "./providers/catalog";
import type { ProviderRegistry } from "./providers/registry";
import { clip, type ProviderPermission, type ToolAnswer, type TurnIO } from "./providers/types";
import type { createThreadStore, StoredThread } from "./threads";

/** A turn while it runs: how to stop it, and the approvals waiting for the user. */
export type RunningTurn = {
  controller: AbortController;
  approvals: Map<string, (decision: AiApprovalDecision) => void>;
};

/** Whether a step of this kind needs the user's approval first. */
const needsApproval = (mode: AiAccessMode, access: AiToolAccess, approved: AiToolAccess[]) => {
  if (access === "read" || approved.includes(access)) return false;
  if (mode === "full-access") return false;
  if (mode === "auto-accept-edits") return access !== "edit" && access !== "web";
  return true;
};

/**
 * Runs one turn of a chat to the end, saving the chat as it goes: the
 * provider's reply streams in, and each tool it calls is checked against the
 * chat's access mode, asking the user first where the mode says so.
 */
export const createTurnRunner = ({
  chatTools,
  providers,
  threads,
  attachments,
  effort,
  running,
  emitItem,
  emitThread,
  sendDelta,
}: {
  chatTools: ChatTools;
  providers: ProviderRegistry;
  threads: ReturnType<typeof createThreadStore>;
  attachments: ReturnType<typeof createAttachmentStore>;
  effort: () => AiEffort | null;
  /** The turns running now, by chat; a turn leaves it when it ends. */
  running: Map<string, RunningTurn>;
  emitItem: (thread: StoredThread, item: AiChatItem) => void;
  emitThread: (thread: StoredThread) => void;
  sendDelta: (delta: { threadId: string; itemId: string; text: string }) => void;
}) =>
  async function runTurn(
    thread: StoredThread,
    turnId: string,
    prompt: string,
    files: AiAttachment[],
    turn: RunningTurn,
  ) {
    const { signal } = turn.controller;
    let reply: Extract<AiChatItem, { kind: "assistant" }> | null = null;
    const tools = chatTools
      .all()
      .filter((tool) => !thread.plan || tool.access === "read" || tool.access === "web")
      // Anthropic and the CLIs read pages with their own web tools.
      .filter((tool) => tool.name !== "loam_web_read" || thread.provider.startsWith("openai"));
    const byName = new Map<string, ChatTool>(tools.map((tool) => [tool.name, tool]));

    /** Shows an approval card and waits for the user's answer; true to go ahead. */
    const ask = async ({
      tool,
      access,
      label,
      preview,
      noteId,
    }: ProviderPermission & { noteId: string | null }) => {
      const approval: Extract<AiChatItem, { kind: "approval" }> = {
        kind: "approval",
        id: randomUUID(),
        turnId,
        tool,
        access,
        label,
        preview,
        noteId,
        status: "pending",
      };
      // Ready for the answer before the card shows, so a quick click isn't lost.
      const answered = new Promise<AiApprovalDecision>((resolve) => {
        if (signal.aborted) return resolve("decline");
        turn.approvals.set(approval.id, resolve);
        signal.addEventListener("abort", () => resolve("decline"), { once: true });
      });
      emitItem(thread, approval);
      await threads.save(thread);
      const decision = await answered;
      turn.approvals.delete(approval.id);
      if (decision === "accept-for-chat" && !thread.approved.includes(access))
        thread.approved.push(access);
      emitItem(thread, { ...approval, status: decision === "decline" ? "declined" : "accepted" });
      return decision !== "decline";
    };
    const askFor = async (tool: ChatTool, input: Record<string, unknown>) => {
      const { label, noteId } = await tool.describe(input);
      const preview = (await tool.preview?.(input).catch(() => null)) ?? null;
      return ask({ tool: tool.name, access: tool.access, label, preview, noteId });
    };

    /** Action items for what the provider does with its own tools, by the provider's key. */
    const activities = new Map<string, string>();

    const callTool = async (name: string, rawInput: unknown): Promise<ToolAnswer> => {
      const tool = byName.get(name);
      if (!tool)
        return {
          content: thread.plan
            ? "Plan mode is on, so nothing can be changed yet. Describe the change in your plan."
            : `There is no tool named ${name}.`,
          isError: true,
        };
      const parsed = tool.inputSchema.safeParse(rawInput);
      if (!parsed.success)
        return {
          content: `The input doesn't fit the tool: ${parsed.error.issues
            .slice(0, 3)
            .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
            .join("; ")}`,
          isError: true,
        };
      const input = rawInput as Record<string, unknown>;
      // The mode is read now, so a change made during the turn applies to its next step.
      if (
        needsApproval(thread.mode, tool.access, thread.approved) &&
        !(await askFor(tool, input))
      ) {
        const { label, noteId } = await tool
          .describe(input)
          .catch(() => ({ label: name, noteId: null }));
        emitItem(thread, {
          kind: "action",
          id: randomUUID(),
          turnId,
          tool: name,
          access: tool.access,
          label,
          noteId,
          status: "declined",
          error: null,
          undoable: false,
        });
        return {
          content: signal.aborted ? "Stopped by the user." : "The user declined this change.",
          isError: true,
        };
      }
      const { label, noteId } = await tool
        .describe(input)
        .catch(() => ({ label: name, noteId: null }));
      const action: Extract<AiChatItem, { kind: "action" }> = {
        kind: "action",
        id: randomUUID(),
        turnId,
        tool: name,
        access: tool.access,
        label,
        noteId,
        status: "running",
        error: null,
        undoable: false,
      };
      emitItem(thread, action);
      try {
        const { result, undo } = await tool.run(input);
        if (undo) thread.undo[action.id] = undo;
        // A created note is known only once it exists.
        const createdId = !noteId && undo?.kind === "note-created" ? undo.noteId : null;
        emitItem(thread, {
          ...action,
          noteId: noteId ?? createdId,
          status: "done",
          undoable: Boolean(undo),
        });
        await threads.save(thread);
        return { content: clip(JSON.stringify(result ?? null)), isError: false };
      } catch (error) {
        const message = toBridgeFailure(error);
        const text = message.ok ? "The tool failed." : message.error.message;
        emitItem(thread, { ...action, status: "failed", error: text });
        return { content: text, isError: true };
      }
    };

    const io: TurnIO = {
      signal,
      usage: (tokens) => {
        if (tokens <= 0) return;
        thread.context = { tokens, window: contextWindowOf(thread.provider, thread.model) };
        emitThread(thread);
      },
      text: (delta) => {
        if (!delta) return;
        if (!reply) {
          reply = { kind: "assistant", id: randomUUID(), turnId, text: "", streaming: true };
          emitItem(thread, reply);
        }
        reply.text += delta;
        sendDelta({ threadId: thread.id, itemId: reply.id, text: delta });
      },
      endText: () => {
        if (!reply) return;
        reply.streaming = false;
        emitItem(thread, reply);
        reply = null;
      },
      callTool,
      activity: ({ key, tool, access, label, status, error = null }) => {
        const id = activities.get(key) ?? randomUUID();
        activities.set(key, id);
        emitItem(thread, {
          kind: "action",
          id,
          turnId,
          tool,
          access,
          label,
          noteId: null,
          status,
          error,
          undoable: false,
        });
      },
      // The approval card shows the answer; what the tool then did comes as activity.
      approve: async (request) =>
        !needsApproval(thread.mode, request.access, thread.approved) ||
        ask({ ...request, noteId: null }),
    };

    try {
      const provider = await providers.providerFor(thread.provider);
      const sameProvider = thread.history?.provider === thread.provider;
      const earlier = !sameProvider && thread.items.length > 1 ? transcriptOf(thread) : "";
      const turnFiles = await Promise.all(
        files.map((attachment) => attachments.forTurn(thread.id, attachment)),
      );
      thread.history = await provider.runTurn({
        model: thread.model,
        system: systemPrompt(thread.plan),
        prompt: earlier ? `Earlier in this chat:\n\n${earlier}\n\n---\n\n${prompt}` : prompt,
        attachments: turnFiles,
        effort: effort(),
        tools,
        mode: thread.mode,
        plan: thread.plan,
        history: sameProvider ? thread.history : null,
        io,
      });
    } catch (error) {
      io.endText();
      if (!signal.aborted) {
        const failure = toBridgeFailure(error);
        const message =
          error instanceof Error && !(error instanceof StoreError)
            ? error.message
            : failure.ok
              ? "The assistant stopped."
              : failure.error.message;
        emitItem(thread, { kind: "error", id: randomUUID(), turnId, message });
      }
    } finally {
      io.endText();
      // A provider that gave up on a call leaves its approval waiting; it no longer applies.
      for (const resolve of turn.approvals.values()) resolve("decline");
      for (const item of thread.items)
        if (item.kind === "approval" && item.status === "pending")
          emitItem(thread, { ...item, status: "declined" });
      running.delete(thread.id);
      await threads.save(thread).catch(() => undefined);
      emitThread(thread);
    }
  };
