/*
 * The messages between the window (the host) and one plugin's worker. Everything in them is
 * plain data; a plugin's functions stay in its worker and are named by id.
 */

/** A drawn element as a plugin returns it: its type, plain props and children. */
export type PluginNode = {
  type: string;
  props: Record<string, unknown>;
  children: (PluginNode | string)[];
};

/** A prop that names a function kept in the worker. */
export type HandlerRef = { __handler: string };

export const isHandlerRef = (value: unknown): value is HandlerRef =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { __handler?: unknown }).__handler === "string";

export type SerializedError = { message: string; code?: string };

export type HostMessage =
  | { t: "init"; pluginId: string; settings: Record<string, unknown> }
  | { t: "settings"; settings: Record<string, unknown> }
  | { t: "hook"; callId: string; hookId: string; e: unknown }
  | { t: "next-result"; nextId: string; ok: true; value: unknown }
  | { t: "next-result"; nextId: string; ok: false; error: SerializedError }
  | { t: "call-result"; reqId: string; ok: true; value: unknown }
  | { t: "call-result"; reqId: string; ok: false; error: SerializedError }
  | { t: "handler"; handlerId: string; payload: unknown }
  | { t: "release"; handlerIds: string[] };

export type WorkerMessage =
  | { t: "on"; hookId: string; event: string; matcher: unknown }
  | { t: "ready" }
  | { t: "load-error"; error: SerializedError }
  | { t: "hook-result"; callId: string; ok: true; value: unknown }
  | { t: "hook-result"; callId: string; ok: false; error: SerializedError }
  | { t: "next"; callId: string; nextId: string; e: unknown }
  | { t: "call"; reqId: string; path: string; args: unknown[] }
  | { t: "log"; level: "info" | "warn" | "error"; text: string };

export const serializeError = (error: unknown): SerializedError => ({
  message: error instanceof Error ? error.message : String(error),
  ...(typeof (error as { code?: unknown } | null)?.code === "string" && {
    code: (error as { code: string }).code,
  }),
});

class PluginCallError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "PluginCallError";
  }
}

export const deserializeError = (error: SerializedError) =>
  new PluginCallError(error.message, error.code);
