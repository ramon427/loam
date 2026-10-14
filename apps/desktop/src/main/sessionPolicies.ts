import { session, type WebContents } from "electron";

import { createNavigationPolicy } from "./navigation";
import type { MainWindow } from "./window";

/** Sent as the referrer of YouTube embeds, which refuse pages without an http origin. */
const APP_REFERRER = "https://io.github.ramon427.loam/";

/**
 * Session rules for the window: clipboard writes and fullscreen video are
 * the only permissions granted, plus, for the app's own page (not embeds),
 * clipboard reads for the editor menu's Paste and the microphone (never a
 * camera) for dictating to the side chat. YouTube embeds get an app referrer.
 */
export const installSessionPolicies = ({
  window,
  rendererUrl,
}: {
  window: MainWindow;
  rendererUrl: string;
}) => {
  const navigationPolicy = createNavigationPolicy(rendererUrl);
  const isWindowContents = (contents: WebContents | null) => {
    const shown = window.current();
    return Boolean(shown && contents?.id === shown.webContents.id);
  };
  const allowed = new Set(["clipboard-sanitized-write", "fullscreen"]);
  const isAllowed = (
    contents: WebContents | null,
    permission: string,
    {
      isMainFrame,
      requestingUrl = "",
      mediaType,
      mediaTypes,
    }: {
      isMainFrame: boolean;
      requestingUrl?: string;
      mediaType?: string;
      mediaTypes?: string[];
    },
  ) => {
    if (!isWindowContents(contents)) return false;
    if (allowed.has(permission)) return true;
    const ownPage = isMainFrame && navigationPolicy.isInternalUrl(requestingUrl);
    if (permission === "clipboard-read") return ownPage;
    // Asked for as audio alone: a check names one kind, a request lists them.
    const audioOnly =
      mediaType === "audio" ||
      (mediaTypes !== undefined &&
        mediaTypes.length > 0 &&
        mediaTypes.every((kind) => kind === "audio"));
    return permission === "media" && ownPage && audioOnly;
  };
  session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) =>
    isAllowed(contents, permission, details),
  );
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(isAllowed(contents, permission, details)),
  );
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ["https://www.youtube.com/embed/*", "https://www.youtube-nocookie.com/embed/*"] },
    (details, callback) => {
      const frameParent = details.frame?.parent;
      if (
        details.resourceType !== "subFrame" ||
        details.webContentsId !== window.current()?.webContents.id ||
        !frameParent ||
        !navigationPolicy.isInternalUrl(frameParent.url)
      )
        return callback({ requestHeaders: details.requestHeaders });
      const headers = Object.fromEntries(
        Object.entries(details.requestHeaders).filter(([name]) => name.toLowerCase() !== "referer"),
      );
      callback({ requestHeaders: { ...headers, Referer: APP_REFERRER } });
    },
  );
};
