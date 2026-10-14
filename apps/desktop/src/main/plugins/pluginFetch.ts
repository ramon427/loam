import type { BridgePluginFetch } from "@loam/shared/plugins/pluginApi";
import { StoreError } from "@loam/storage/storeError";

const MAX_FETCH_BODY_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;

/** What a plugin asks to fetch; its address was already checked against what it was granted. */
export type PluginFetchRequest = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

/**
 * Fetches for a plugin without cookies or redirects, with the request and
 * response each held to a size and the whole to a time limit.
 */
export const fetchForPlugin = async (request: PluginFetchRequest): Promise<BridgePluginFetch> => {
  if (request.body && Buffer.byteLength(request.body) > MAX_FETCH_BODY_BYTES)
    throw new StoreError("The request body is over 1 MB.", "PLUGIN_TOO_LARGE", 413);
  const response = await fetch(request.url, {
    method: request.method ?? "GET",
    headers: request.headers,
    body: request.body,
    redirect: "manual",
    credentials: "omit",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  // Read as it arrives, so a response over the limit stops there.
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.byteLength;
    if (size > MAX_RESPONSE_BYTES)
      throw new StoreError("The response is over 5 MB.", "PLUGIN_TOO_LARGE", 413);
    chunks.push(chunk);
  }
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: new TextDecoder().decode(Buffer.concat(chunks)),
  };
};
