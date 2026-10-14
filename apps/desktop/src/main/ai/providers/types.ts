import type { AiAccessMode, AiActionStatus, AiEffort, AiToolAccess } from "@loam/shared/ai/aiChat";

import type { ChatTool } from "../chatTools";
import type { ProviderHistory } from "../threads";

/** A tool call's answer, as the model reads it. */
export type ToolAnswer = { content: string; isError: boolean };

/** Something the provider did with its own tools, such as a web search or a command. */
type ProviderActivity = {
  /** The provider's id for the call; a later report with the same key updates it. */
  key: string;
  tool: string;
  access: AiToolAccess;
  label: string;
  status: Extract<AiActionStatus, "running" | "done" | "failed">;
  error?: string | null;
};

/** A request to use one of the provider's own tools, for the user to approve. */
export type ProviderPermission = {
  tool: string;
  access: AiToolAccess;
  label: string;
  preview: string | null;
};

/** What a provider reports back while it runs one turn. */
export type TurnIO = {
  /** Text of the reply as it streams; a new reply item starts after each tool call. */
  text: (delta: string) => void;
  /** Ends the reply text so far, before a tool call. */
  endText: () => void;
  /** Runs a tool call, asking the user first when the chat's access mode says so. */
  callTool: (name: string, input: unknown) => Promise<ToolAnswer>;
  /** Shows what the provider did with its own tools. */
  activity: (entry: ProviderActivity) => void;
  /** How many tokens the conversation takes up after a step: what was sent and what came back. */
  usage: (contextTokens: number) => void;
  /** Asks before the provider uses one of its own tools, as the chat's access mode says; true to go ahead. */
  approve: (request: ProviderPermission) => Promise<boolean>;
  signal: AbortSignal;
};

/**
 * A file sent with the turn's message. Images and PDFs go to models that read
 * them as they are; `text` is what the others read instead.
 */
export type TurnAttachment = {
  name: string;
  kind: "image" | "pdf" | "text";
  mimeType: string;
  data: Buffer;
  text: string | null;
};

export type TurnRequest = {
  model: string;
  /** Stable instructions; the user's context goes in `prompt`, so caching holds. */
  system: string;
  prompt: string;
  attachments: TurnAttachment[];
  /** How hard the model thinks; null leaves it to the model. */
  effort: AiEffort | null;
  /** Only the tools this turn may use; plan mode offers reading only. */
  tools: ChatTool[];
  /** The chat's access mode when the turn starts, for providers that run their own tools. */
  mode: AiAccessMode;
  plan: boolean;
  /**
   * The chat so far, when it was with this provider. Null starts fresh; a
   * chat continued from another provider carries its earlier messages in `prompt`.
   */
  history: ProviderHistory | null;
  io: TurnIO;
};

/** Runs turns against one model source; returns how to continue the chat. */
export type ChatProvider = {
  runTurn: (request: TurnRequest) => Promise<ProviderHistory>;
};

/** Tool results stay small enough not to crowd out the chat. */
const MAX_TOOL_RESULT_CHARS = 120_000;

export const clip = (text: string) =>
  text.length > MAX_TOOL_RESULT_CHARS
    ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n… (cut off; ask for less, such as one note or a search)`
    : text;

/** A file as text, for a model that reads it as part of the message. */
export const attachmentText = (attachment: TurnAttachment) =>
  `<file name="${attachment.name.replaceAll('"', "'")}">\n${attachment.text ?? "(no text could be read from this file)"}\n</file>`;

/** The effort as APIs with three levels name it: low, medium or high. */
export const threeLevelEffort = (effort: AiEffort) =>
  effort === "xhigh" || effort === "max" ? "high" : effort;
