import type {
  LoamBridge,
  LoamBridgeEvent,
  LoamBridgeEvents,
  LoamBridgeMethod,
  LoamBridgeParams,
  LoamBridgeResult,
} from "@loam/shared/bridge/loamBridge";

declare global {
  interface Window {
    /** Set by the preload script; tests assign a fake. */
    loam: LoamBridge;
  }
}

/** A failed bridge request. `code` is the store's reason, such as `NOT_FOUND`. */
export class BridgeError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
  }
}

/** Sends one request to the main process and returns its data; throws `BridgeError` on failure. */
export const callBridge = async <M extends LoamBridgeMethod>(
  method: M,
  params: LoamBridgeParams<M>,
): Promise<LoamBridgeResult<M>> => {
  const result = await window.loam.invoke(method, params);
  if (!result.ok) throw new BridgeError(result.error.message, result.error.code);
  return result.data;
};

/** Calls `listener` with each `event` the main process sends; returns an unsubscribe. */
export const onBridgeEvent = <E extends LoamBridgeEvent>(
  event: E,
  listener: (payload: LoamBridgeEvents[E]) => void,
): (() => void) => window.loam.on(event, listener);
