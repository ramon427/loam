import { LOAM_APP_HOST, LOAM_APP_PROTOCOL } from "@loam/shared/bridge/loamBridge";

const parseUrl = (value: string) => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

/** Only http(s) and mail links leave the app, and they open in the system browser. */
export const isSafeExternalUrl = (value: string) => {
  if (typeof value !== "string" || value.length > 2048) return false;
  const url = parseUrl(value);
  if (!url || url.username || url.password) return false;
  return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:";
};

export const createNavigationPolicy = (rendererUrl: string) => {
  const rendererOrigin = parseUrl(rendererUrl)?.origin ?? null;
  return Object.freeze({
    isInternalUrl(value: string) {
      const url = parseUrl(value);
      if (!url) return false;
      if (url.protocol === `${LOAM_APP_PROTOCOL}:`) return url.hostname === LOAM_APP_HOST;
      return rendererOrigin !== null && rendererOrigin !== "null" && url.origin === rendererOrigin;
    },
  });
};
