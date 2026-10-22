import type {
  LoamBridge,
  LoamBridgeEvent,
  LoamBridgeEvents,
  LoamBridgeMethod,
  LoamBridgeParams,
  LoamBridgeResult,
} from "@loam/shared/bridge/loamBridge";
import { BridgeError } from "@loam/notes-ui/host/notesHost";

declare global {
  interface Window {
    /** Set by the preload script; tests assign a fake. */
    loam: LoamBridge;
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
