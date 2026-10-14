import {
  deserializeError,
  serializeError,
  type HostMessage,
  type PluginNode,
  type WorkerMessage,
} from "./protocol";

/*
 * What runs inside a plugin's worker, around the plugin's own module: `on` for its hooks, the
 * `$` it reaches the app through, `next` along each hook chain, and `h` for its drawings. It
 * holds no app state; every `$` call is a message to the window, which decides.
 */

type Hook = ($: unknown, e: unknown, next: (e?: unknown) => Promise<unknown>) => unknown;

/** A hook as a plugin writes it; its `$` and `e` are typed by the plugin (see @loam/plugin-api). */
type AnyHook = ($: never, e: never, next: (e?: unknown) => Promise<unknown>) => unknown;

type On = {
  (event: string, hook: AnyHook): void;
  (event: string, matcher: unknown, hook: AnyHook): void;
};

export type Register = (on: On, options: Record<string, unknown>) => unknown;

/** The `$` paths a plugin may call; each becomes one message the window answers. */
const API = {
  notes: ["get", "list", "search", "backlinks", "create", "setTitle", "append", "trash"],
  ui: ["toast", "open", "close", "invalidate", "openNote"],
  commands: ["register"],
  editor: ["registerSlashItem"],
  state: ["get", "set"],
  store: ["get", "set"],
  net: ["fetch"],
  settings: ["get"],
  app: ["activeNote"],
} as const;

export const ELEMENT_NAMES = [
  "Box",
  "Text",
  "Heading",
  "Button",
  "Input",
  "Checkbox",
  "Select",
  "Divider",
  "Icon",
  "Badge",
] as const;

const Fragment = "Fragment";

type Port = {
  post: (message: WorkerMessage) => void;
  listen: (handler: (message: HostMessage) => void) => void;
};

export const createRuntime = (port: Port) => {
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}${(counter += 1).toString(36)}`;

  const hooks = new Map<string, Hook>();
  const handlers = new Map<string, (payload: unknown) => unknown>();
  const calls = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  const nexts = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  let settings: Record<string, unknown> = {};

  const call = (path: string, args: unknown[]) =>
    new Promise<unknown>((resolve, reject) => {
      const reqId = nextId("r");
      calls.set(reqId, { resolve, reject });
      port.post({ t: "call", reqId, path, args });
    });

  const $ = Object.freeze(
    Object.fromEntries(
      Object.entries(API).map(([area, methods]) => [
        area,
        Object.freeze(
          Object.fromEntries(
            methods.map((method) => [
              method,
              (...args: unknown[]) =>
                area === "settings" && method === "get"
                  ? Promise.resolve({ ...settings })
                  : call(`${area}.${method}`, args),
            ]),
          ),
        ),
      ]),
    ),
  );

  /** Replaces each function in a drawing's props with an id the window sends back on use. */
  const plain = (value: unknown, depth = 0): unknown => {
    if (depth > 8) return null;
    if (typeof value === "function") {
      const handlerId = nextId("h");
      handlers.set(handlerId, value as (payload: unknown) => unknown);
      return { __handler: handlerId };
    }
    if (Array.isArray(value)) return value.map((item) => plain(item, depth + 1));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, plain(item, depth + 1)]),
      );
    return value;
  };

  const flatten = (children: unknown[], into: (PluginNode | string)[] = []) => {
    for (const child of children) {
      if (child === null || child === undefined || typeof child === "boolean") continue;
      if (Array.isArray(child)) flatten(child, into);
      else if (typeof child === "string" || typeof child === "number") into.push(String(child));
      else if (typeof child === "object" && (child as { type?: unknown }).type === Fragment)
        flatten((child as PluginNode).children, into);
      else into.push(child as PluginNode);
    }
    return into;
  };

  /** The JSX factory: `<Box gap={2}>…</Box>` becomes plain data the window draws. */
  const h = (
    type: string | ((props: Record<string, unknown>) => unknown),
    props: Record<string, unknown> | null,
    ...children: unknown[]
  ): unknown => {
    if (typeof type === "function") return type({ ...props, children });
    const { key: _key, children: propChildren, ...rest } = props ?? {};
    const all = children.length ? children : propChildren === undefined ? [] : [propChildren];
    return {
      type,
      props: plain(rest) as Record<string, unknown>,
      children: flatten(all),
    } satisfies PluginNode;
  };

  const on = (event: string, matcherOrHook: unknown, maybeHook?: Hook) => {
    const hook = (typeof matcherOrHook === "function" ? matcherOrHook : maybeHook) as
      Hook | undefined;
    if (typeof event !== "string" || typeof hook !== "function")
      throw new TypeError("on(event, matcher?, hook) needs an event name and a hook function.");
    const matcher = typeof matcherOrHook === "function" ? undefined : matcherOrHook;
    const hookId = nextId("k");
    hooks.set(hookId, hook);
    port.post({ t: "on", hookId, event, matcher: plain(matcher) });
  };

  const runHook = async (callId: string, hookId: string, e: unknown) => {
    const hook = hooks.get(hookId);
    const next = (changed?: unknown) =>
      new Promise<unknown>((resolve, reject) => {
        const id = nextId("n");
        nexts.set(id, { resolve, reject });
        port.post({ t: "next", callId, nextId: id, e: changed === undefined ? e : plain(changed) });
      });
    try {
      if (!hook) throw new Error("That hook is gone.");
      const value = await hook($, Object.freeze(e), next);
      port.post({ t: "hook-result", callId, ok: true, value: plain(value) });
    } catch (error) {
      port.post({ t: "hook-result", callId, ok: false, error: serializeError(error) });
    }
  };

  const settle = (
    pending: Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>,
    id: string,
    message:
      { ok: true; value: unknown } | { ok: false; error: { message: string; code?: string } },
  ) => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (message.ok) entry.resolve(message.value);
    else entry.reject(deserializeError(message.error));
  };

  const start = async (register: unknown) => {
    try {
      if (typeof register !== "function")
        throw new Error("The plugin's module must export a register function.");
      await (register as Register)(on as On, { ...settings });
      port.post({ t: "ready" });
    } catch (error) {
      port.post({ t: "load-error", error: serializeError(error) });
    }
  };

  port.listen((message) => {
    switch (message.t) {
      case "init":
      case "settings":
        settings = { ...message.settings };
        return;
      case "hook":
        void runHook(message.callId, message.hookId, message.e);
        return;
      case "next-result":
        settle(nexts, message.nextId, message);
        return;
      case "call-result":
        settle(calls, message.reqId, message);
        return;
      case "handler": {
        const handler = handlers.get(message.handlerId);
        if (!handler) return;
        Promise.resolve()
          .then(() => handler(message.payload))
          .catch((error: unknown) =>
            port.post({ t: "log", level: "error", text: serializeError(error).message }),
          );
        return;
      }
      case "release":
        for (const id of message.handlerIds) handlers.delete(id);
        return;
    }
  });

  return { $, h, on, start, Fragment };
};
