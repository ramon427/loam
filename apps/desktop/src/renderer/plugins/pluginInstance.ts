import type { HookRegistration } from "./hookChain";
import { deserializeError, serializeError, type HostMessage, type WorkerMessage } from "./protocol";

/** How long a hook may run, not counting the time the rest of its chain takes. */
const HOOK_BUDGET_MS = 5_000;

/** The window's end of a worker: tests pass an in-process one. */
export type WorkerPort = {
  post: (message: HostMessage | { t: "load"; code: string }) => void;
  listen: (handler: (message: WorkerMessage) => void) => void;
  terminate: () => void;
};

type PendingHook = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  next: (e: unknown) => Promise<unknown>;
  timer: ReturnType<typeof setTimeout> | undefined;
  restart: () => void;
};

/**
 * One running plugin as the window sees it: its worker, the hooks it added, and the calls
 * between them. `onCall` answers the plugin's `$` calls.
 */
export const createPluginInstance = ({
  pluginId,
  port,
  onCall,
  onHook,
  onLog,
}: {
  pluginId: string;
  port: WorkerPort;
  onCall: (path: string, args: unknown[]) => Promise<unknown>;
  onHook: (registration: HookRegistration) => void;
  onLog: (level: "info" | "warn" | "error", text: string) => void;
}) => {
  let counter = 0;
  const pending = new Map<string, PendingHook>();
  let stopped = false;
  let readyResolve: (() => void) | undefined;
  let readyReject: ((error: Error) => void) | undefined;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  port.listen((message) => {
    if (stopped) return;
    switch (message.t) {
      case "on":
        onHook({
          pluginId,
          hookId: message.hookId,
          event: message.event,
          matcher: message.matcher,
        });
        return;
      case "ready":
        readyResolve?.();
        return;
      case "load-error":
        readyReject?.(deserializeError(message.error));
        return;
      case "hook-result": {
        const entry = pending.get(message.callId);
        if (!entry) return;
        pending.delete(message.callId);
        clearTimeout(entry.timer);
        if (message.ok) entry.resolve(message.value);
        else entry.reject(deserializeError(message.error));
        return;
      }
      case "next": {
        const entry = pending.get(message.callId);
        if (!entry) return;
        // The rest of the chain doesn't count against this hook's time.
        clearTimeout(entry.timer);
        entry
          .next(message.e)
          .then(
            (value) => port.post({ t: "next-result", nextId: message.nextId, ok: true, value }),
            (error: unknown) =>
              port.post({
                t: "next-result",
                nextId: message.nextId,
                ok: false,
                error: serializeError(error),
              }),
          )
          .finally(() => {
            if (pending.has(message.callId)) entry.restart();
          });
        return;
      }
      case "call":
        onCall(message.path, message.args).then(
          (value) => port.post({ t: "call-result", reqId: message.reqId, ok: true, value }),
          (error: unknown) =>
            port.post({
              t: "call-result",
              reqId: message.reqId,
              ok: false,
              error: serializeError(error),
            }),
        );
        return;
      case "log":
        onLog(message.level, message.text);
        return;
    }
  });

  return {
    pluginId,
    ready,

    load(code: string, settings: Record<string, unknown>) {
      port.post({ t: "init", pluginId, settings });
      port.post({ t: "load", code });
    },

    setSettings(settings: Record<string, unknown>) {
      port.post({ t: "settings", settings });
    },

    invoke(hookId: string, e: unknown, next: (e: unknown) => Promise<unknown>) {
      if (stopped) return Promise.reject(new Error("The plugin stopped."));
      const callId = `c${(counter += 1).toString(36)}`;
      return new Promise<unknown>((resolve, reject) => {
        const entry: PendingHook = {
          resolve,
          reject,
          next,
          timer: undefined,
          restart: () => {
            clearTimeout(entry.timer);
            entry.timer = setTimeout(() => {
              pending.delete(callId);
              reject(new Error(`A hook took longer than ${HOOK_BUDGET_MS / 1000} seconds.`));
            }, HOOK_BUDGET_MS);
          },
        };
        pending.set(callId, entry);
        entry.restart();
        port.post({ t: "hook", callId, hookId, e });
      });
    },

    press(handlerId: string, payload: unknown) {
      if (!stopped) port.post({ t: "handler", handlerId, payload });
    },

    release(handlerIds: string[]) {
      if (!stopped && handlerIds.length) port.post({ t: "release", handlerIds });
    },

    stop() {
      stopped = true;
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error("The plugin stopped."));
      }
      pending.clear();
      readyReject?.(new Error("The plugin stopped."));
      port.terminate();
    },
  };
};

export type PluginInstance = ReturnType<typeof createPluginInstance>;
