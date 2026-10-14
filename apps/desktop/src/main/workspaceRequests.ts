import { randomUUID } from "node:crypto";

import type { BridgeAutomationCommand, BridgeResult } from "@loam/shared/bridge/loamBridge";
import { StoreError } from "@loam/storage/storeError";

const REQUEST_TIMEOUT_MS = 30_000;
/** Converting a large import runs the editor's parsers over every file. */
const IMPORT_TIMEOUT_MS = 300_000;

const windowUnavailable = (message: string): BridgeResult<never> => ({
  ok: false,
  error: { code: "WINDOW_UNAVAILABLE", message, status: 503 },
});

/**
 * Requests only the window can carry out for an AI client: it owns the
 * editor's pending edits, its parsers and converters, and what is on screen.
 * Each request is sent as an `app.automation` event and settled by the
 * window's `app.automationResult` reply, or by a timeout.
 */
export const createWorkspaceRequests = ({
  send,
  isWindowReady,
}: {
  /** Sends the request to the window; false when no window has loaded the app. */
  send: (request: { requestId: string; command: BridgeAutomationCommand }) => boolean;
  isWindowReady: () => boolean;
}) => {
  const pending = new Map<
    string,
    { resolve: (result: BridgeResult<unknown>) => void; timer: NodeJS.Timeout }
  >();

  const request = (command: BridgeAutomationCommand): Promise<unknown> => {
    const requestId = randomUUID();
    return new Promise<BridgeResult<unknown>>((resolve) => {
      const timer = setTimeout(
        () => {
          pending.delete(requestId);
          resolve(windowUnavailable("The notes window did not respond. Open Loam and try again."));
        },
        command.action === "convertImport" ? IMPORT_TIMEOUT_MS : REQUEST_TIMEOUT_MS,
      );
      pending.set(requestId, { resolve, timer });
      if (!send({ requestId, command })) {
        clearTimeout(timer);
        pending.delete(requestId);
        resolve(windowUnavailable("The Loam window isn't open yet. Try again in a moment."));
      }
    }).then((result) => {
      if (!result.ok)
        throw new StoreError(result.error.message, result.error.code, result.error.status);
      return result.data;
    });
  };

  return {
    request,

    /**
     * Saves the window's pending edits. A window that isn't open, or is still
     * loading the app, holds none.
     */
    async flush() {
      if (isWindowReady()) await request({ action: "flush" });
    },

    respond(requestId: string, result: BridgeResult<unknown>) {
      const waiting = pending.get(requestId);
      if (!waiting) return;
      clearTimeout(waiting.timer);
      pending.delete(requestId);
      waiting.resolve(result);
    },

    /** Settles every waiting request when the window goes away. */
    close() {
      for (const [id, waiting] of pending) {
        clearTimeout(waiting.timer);
        pending.delete(id);
        waiting.resolve(windowUnavailable("The notes window closed."));
      }
    },
  };
};

export type WorkspaceRequests = ReturnType<typeof createWorkspaceRequests>;
