import { ipcMain } from "electron";

import {
  LOAM_BRIDGE_CHANNEL_PREFIX,
  LOAM_BRIDGE_METHODS,
  type BridgeResult,
  type LoamBridgeMethod,
  type LoamBridgeResult,
} from "@loam/shared/bridge/loamBridge";
import { StoreError } from "@loam/storage/storeError";

import type { LibraryGate } from "../libraryGate";
import type { MainWindow } from "../window";
import type { Handlers } from "./handlers";
import { BRIDGE_PARAMS } from "./params";

/** A failure as callers receive it: the app's own errors as they are, anything else generic. */
export const toBridgeFailure = (error: unknown): BridgeResult<never> => {
  if (error instanceof StoreError)
    return { ok: false, error: { code: error.code, message: error.message, status: error.status } };
  console.error("A request failed", error);
  return {
    ok: false,
    error: {
      code: "STORE_ERROR",
      message: "The notes store could not finish the request.",
      status: 500,
    },
  };
};

/** Who made a request: the app's window, or an AI client through MCP. */
export type Caller = "window" | "ai";

export type Dispatch = <M extends LoamBridgeMethod>(
  method: M,
  params: unknown,
  caller: Caller,
) => Promise<BridgeResult<LoamBridgeResult<M>>>;

/**
 * Runs a request: checks that the caller may make it now and its params,
 * runs its handler, and settles to a result.
 */
export const createDispatch =
  (handlers: Handlers, gate: Pick<LibraryGate, "checkAccess">): Dispatch =>
  async (method, params, caller) => {
    try {
      gate.checkAccess(method, caller);
      const parsed = BRIDGE_PARAMS[method].safeParse(params ?? {});
      if (!parsed.success) {
        const where = parsed.error.issues[0]?.path.join(".");
        throw new StoreError(
          `Invalid request${where ? `: ${where}` : ""}.`,
          "VALIDATION_ERROR",
          400,
        );
      }
      return { ok: true, data: await handlers[method](parsed.data, caller) };
    } catch (error) {
      return toBridgeFailure(error);
    }
  };

/** Answers the window's requests, from its own top frame only. */
export const installIpc = (window: MainWindow, dispatch: Dispatch) => {
  for (const method of LOAM_BRIDGE_METHODS) {
    ipcMain.handle(`${LOAM_BRIDGE_CHANNEL_PREFIX}${method}`, (event, params: unknown) => {
      if (!window.isTrustedSender(event)) throw new Error("Untrusted IPC sender");
      return dispatch(method, params, "window");
    });
  }
};
