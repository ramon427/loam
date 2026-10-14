import { readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";

import { LOAM_APP_HOST, LOAM_APP_PROTOCOL } from "@loam/shared/bridge/loamBridge";
import { isInsideDirectory } from "@loam/storage/files";

import {
  isPluginWorkerAsset,
  PLUGIN_WORKER_CONTENT_SECURITY_POLICY,
} from "../shared/contentSecurityPolicy";

export const MIME_TYPES = new Map([
  [".avif", "image/avif"],
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".wasm", "application/wasm"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

/** Resolves a request path inside `root`, rejecting traversal and NUL bytes. */
export const resolveInside = (root: string, pathname: string): string | null => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const candidate = resolve(root, decoded.replace(/^\/+/, ""));
  return isInsideDirectory(root, candidate) ? candidate : null;
};

const isFile = async (path: string) => {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
};

const notFound = () =>
  new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });

/** Serves the built renderer; unknown extension-less paths fall back to the SPA shell. */
export const createRendererProtocolHandler =
  (rendererRoot: string, contentSecurityPolicy: string) => async (request: Request) => {
    const url = new URL(request.url);
    if (url.protocol !== `${LOAM_APP_PROTOCOL}:` || url.hostname !== LOAM_APP_HOST)
      return notFound();
    const requested = resolveInside(rendererRoot, url.pathname);
    let filePath: string | null = null;
    if (requested && extname(requested) && (await isFile(requested))) filePath = requested;
    else if (!extname(url.pathname)) filePath = resolve(rendererRoot, "index.html");
    if (!filePath || !(await isFile(filePath))) return notFound();
    return new Response(await readFile(filePath), {
      headers: {
        // A plugin's worker gets a policy of its own; see PLUGIN_WORKER_CONTENT_SECURITY_POLICY.
        "Content-Security-Policy": isPluginWorkerAsset(url.pathname)
          ? PLUGIN_WORKER_CONTENT_SECURITY_POLICY
          : contentSecurityPolicy,
        "Content-Type": MIME_TYPES.get(extname(filePath)) ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      },
    });
  };
