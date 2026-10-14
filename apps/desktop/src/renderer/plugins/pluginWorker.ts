/// <reference lib="webworker" />

import type { HostMessage, WorkerMessage } from "./protocol";
import { createRuntime, ELEMENT_NAMES } from "./runtime";

/*
 * One plugin's worker. The window sends the plugin's module as text; it is imported from a blob
 * URL, which the worker's policy allows, and nothing else may load. The network APIs are taken
 * away as well, for builds served without that policy (the dev server).
 */

declare const self: DedicatedWorkerGlobalScope;

const post = self.postMessage.bind(self);
let listener: ((message: HostMessage) => void) | undefined;
let loaded = false;

const runtime = createRuntime({
  post: (message: WorkerMessage) => post(message),
  listen: (handler) => {
    listener = handler;
  },
});

for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "WebTransport"]) {
  try {
    Object.defineProperty(self, name, { value: undefined, configurable: false, writable: false });
  } catch {
    // Already gone.
  }
}

Object.assign(self, {
  h: runtime.h,
  Fragment: runtime.Fragment,
  ...Object.fromEntries(ELEMENT_NAMES.map((name) => [name, name])),
});

self.onmessage = async (event: MessageEvent<HostMessage | { t: "load"; code: string }>) => {
  const message = event.data;
  if (message.t !== "load") {
    listener?.(message);
    return;
  }
  if (loaded) return;
  loaded = true;
  const url = URL.createObjectURL(new Blob([message.code], { type: "text/javascript" }));
  try {
    const module = (await import(/* @vite-ignore */ url)) as {
      register?: unknown;
      default?: unknown;
    };
    await runtime.start(module.register ?? module.default);
  } catch (error) {
    post({
      t: "load-error",
      error: { message: error instanceof Error ? error.message : String(error) },
    } satisfies WorkerMessage);
  } finally {
    URL.revokeObjectURL(url);
  }
};
