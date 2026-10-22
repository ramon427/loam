/**
 * Requests from AI clients (see automation.ts) to parts of the app that sit
 * deep in the React tree. Automation runs outside the tree, so it asks
 * through these events instead of props or context.
 */
type AppEventMap = {
  /** Opens a note, at one of its tabs, or (with null) leaves the open one. */
  "notes:open": { noteId: string | null; tabId?: string };
  /** Asks which note and tab are open. */
  "notes:read-open": {
    respond: (open: { noteId: string | null; tabId: string | null }) => void;
  };
  /** Opens the open note's video pane; answers with its video id if it has one. */
  "notes:open-video": { respond: (videoId: string) => void };
};

type AppEventName = keyof AppEventMap;

const appEventBus = new EventTarget();

export const emitAppEvent = <K extends AppEventName>(name: K, detail: AppEventMap[K]) => {
  appEventBus.dispatchEvent(new CustomEvent(name, { detail }));
};

export const onAppEvent = <K extends AppEventName>(
  name: K,
  handler: (event: CustomEvent<AppEventMap[K]>) => void,
) => {
  const listener = (event: Event) => handler(event as CustomEvent<AppEventMap[K]>);
  appEventBus.addEventListener(name, listener);
  return () => appEventBus.removeEventListener(name, listener);
};
