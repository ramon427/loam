/**
 * The side chat: an AI assistant inside the app, off until the user turns it
 * on. The model comes from the user's own API key or from a CLI they have
 * installed and signed in to. The main process runs every turn; the window
 * shows what it sends as `ai.event`.
 */

/** Where replies come from: an API with the user's key, or a CLI on this computer. */
export const AI_PROVIDER_IDS = [
  "anthropic",
  "openai",
  "openai-compatible",
  "claude-cli",
  "codex-cli",
] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

/** Providers that need an API key, kept encrypted by the operating system. */
export const AI_KEY_PROVIDER_IDS = ["anthropic", "openai", "openai-compatible"] as const;
export type AiKeyProviderId = (typeof AI_KEY_PROVIDER_IDS)[number];

/**
 * How much the assistant may do without asking. Reading notes is always
 * allowed; "web" reaches a web site from this computer, which can carry what
 * the assistant read to that site; "edit" changes the content of existing
 * notes; "organize" creates, moves, renames or deletes notes, folders and
 * projects; "outside" acts beyond Loam, such as clicking or typing in a web
 * page, reading files on this computer or running a command, and can't be
 * undone from the chat.
 */
export const AI_ACCESS_MODES = ["supervised", "auto-accept-edits", "full-access"] as const;
export type AiAccessMode = (typeof AI_ACCESS_MODES)[number];

/**
 * How hard the model thinks before it answers; null leaves it to the model.
 * Providers without such a setting ignore it.
 */
export const AI_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type AiEffort = (typeof AI_EFFORTS)[number];

/**
 * A model id as providers name them ("claude-opus-5-5", "gpt-5.1",
 * "org/model:tag", "opus[1m]"). It is passed to CLIs on their command line,
 * so it holds nothing a shell would read.
 */
export const AI_MODEL_ID = /^[\w.:/@[\]-]{1,200}$/;

export type AiToolAccess = "read" | "web" | "edit" | "organize" | "outside";

export type AiProviderStatus = {
  id: AiProviderId;
  label: string;
  kind: "api-key" | "cli";
  /** A key is saved, or the CLI was found. */
  ready: boolean;
  /** "Key ending in 4f2a", "claude 2.1.0", or why it isn't ready. */
  detail: string | null;
  /** Suggested models; the user may type another. */
  models: string[];
  /** Runs a CLI under the user's own subscription; its terms decide what is allowed. */
  experimental: boolean;
};

export type AiChatStatus = {
  enabled: boolean;
  provider: AiProviderId;
  model: string;
  /** For the OpenAI-compatible provider, such as OpenRouter or a local Ollama. */
  baseUrl: string | null;
  /** The access mode new chats start in. */
  defaultMode: AiAccessMode;
  effort: AiEffort | null;
  /** Speech can be written into messages: it is transcribed with the saved OpenAI key. */
  canDictate: boolean;
  providers: AiProviderStatus[];
  error: string | null;
};

export type AiChatConfigure = {
  enabled?: boolean;
  provider?: AiProviderId;
  model?: string;
  baseUrl?: string | null;
  defaultMode?: AiAccessMode;
  effort?: AiEffort | null;
};

/** What the user was looking at when they sent a message. */
export type AiChatContext = {
  noteId: string | null;
  noteTitle: string | null;
  /** Text selected in the note, if any. */
  selection: string | null;
  /** Notes the user named in the message with @; older messages have none. */
  mentions?: { noteId: string; title: string }[];
};

/**
 * A file sent with a message. Images and PDFs reach the model as they are,
 * where it reads them; anything else as its text.
 */
export type AiAttachment = {
  id: string;
  name: string;
  kind: "image" | "pdf" | "text";
  mimeType: string;
  /** Bytes of the file as attached. */
  size: number;
};

/** A file the window sends with a message: its bytes, and its text where the window read it. */
export type AiAttachmentUpload = {
  name: string;
  bytes: Uint8Array;
  /** The text of a PDF or Word document, for models that can't read the file itself. */
  text: string | null;
};

/** How many files one message carries at most, and how many of them can be images. */
export const MAX_AI_ATTACHMENTS = 8;
export const MAX_AI_IMAGE_ATTACHMENTS = 4;

export type AiActionStatus = "running" | "done" | "failed" | "declined" | "undone";

/** One entry in a chat, in order. Items with the same id replace each other. */
export type AiChatItem =
  | {
      kind: "user";
      id: string;
      turnId: string;
      text: string;
      context: AiChatContext | null;
      /** Files sent with the message; older chats have none. */
      attachments?: AiAttachment[];
      at: number;
    }
  | { kind: "assistant"; id: string; turnId: string; text: string; streaming: boolean }
  | {
      kind: "action";
      id: string;
      turnId: string;
      tool: string;
      access: AiToolAccess;
      /** "Edited Weekly review", "Searched for 'launch'". */
      label: string;
      /** The note the action is about, to open it from the chat. */
      noteId: string | null;
      status: AiActionStatus;
      error: string | null;
      undoable: boolean;
    }
  | {
      kind: "approval";
      id: string;
      turnId: string;
      tool: string;
      access: AiToolAccess;
      label: string;
      /** What would change, as text the user can read before deciding. */
      preview: string | null;
      noteId: string | null;
      status: "pending" | "accepted" | "declined";
    }
  | { kind: "error"; id: string; turnId: string; message: string };

export type AiThreadSummary = {
  id: string;
  title: string;
  updatedAt: number;
  running: boolean;
};

/** How much of the model's context the chat fills: tokens after its last step, of how many it holds. */
export type AiContextUsage = { tokens: number; window: number | null };

export type AiThread = AiThreadSummary & {
  createdAt: number;
  mode: AiAccessMode;
  provider: AiProviderId;
  model: string;
  items: AiChatItem[];
  /** Chats that haven't run since this was kept have none. */
  context?: AiContextUsage;
};

export type AiApprovalDecision = "accept" | "accept-for-chat" | "decline";

/** What the main process tells the window while chats run. */
export type AiChatEvent =
  | { type: "item"; threadId: string; item: AiChatItem }
  | { type: "delta"; threadId: string; itemId: string; text: string }
  | {
      type: "thread";
      thread: AiThreadSummary & { mode: AiAccessMode; context?: AiContextUsage };
    }
  | { type: "threads"; threads: AiThreadSummary[] };
