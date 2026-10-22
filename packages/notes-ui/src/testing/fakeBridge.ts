import { vi } from "vitest";

import type {
  LoamBridge,
  LoamBridgeEvent,
  LoamBridgeEvents,
  LoamBridgeMethod,
} from "@loam/shared/bridge/loamBridge";

import { configureNotesHost, type NotesHost } from "../host/notesHost";

declare global {
  interface Window {
    /** Loam's preload sets it; tests assign a fake. */
    loam: LoamBridge;
  }
}

/** Each test types the params its handlers read. */
type Handler = (params: never) => unknown;

/**
 * Sets `window.loam` to a bridge that answers each method with its handler, or
 * null without one. A handler that throws fails the call with the error's
 * `code` (default `FAILED`) and message; throw a `BridgeError` to pick the code.
 * `capabilities` turns off what a host without them hides. Returns the `invoke` spy and `emit`, which sends an event to the listeners
 * the window registered.
 */
export const installFakeBridge = (
  handlers: Partial<Record<LoamBridgeMethod, Handler>>,
  { capabilities }: { capabilities?: NotesHost["capabilities"] } = {},
) => {
  const invoke = vi.fn(async (method: LoamBridgeMethod, params: unknown) => {
    try {
      return { ok: true, data: (await handlers[method]?.(params as never)) ?? null };
    } catch (error) {
      const { message, code = "FAILED" } = error as Error & { code?: string };
      return { ok: false, error: { code, message, status: 500 } };
    }
  });
  const listeners = new Map<LoamBridgeEvent, Set<(payload: never) => void>>();
  const on: LoamBridge["on"] = (event, listener) => {
    const forEvent = listeners.get(event) ?? new Set();
    listeners.set(event, forEvent);
    forEvent.add(listener);
    return () => forEvent.delete(listener);
  };
  window.loam = {
    invoke: invoke as unknown as LoamBridge["invoke"],
    on,
    platform: "linux",
    pathForFile: () => "",
  };
  configureNotesHost({ ...window.loam, capabilities });
  return {
    invoke,
    emit: <E extends LoamBridgeEvent>(event: E, payload: LoamBridgeEvents[E]) => {
      for (const listener of listeners.get(event) ?? []) listener(payload as never);
    },
  };
};
