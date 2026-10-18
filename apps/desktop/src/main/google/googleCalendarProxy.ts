import type {
  PluginGoogleCalendarRequest as GoogleCalendarRequest,
  PluginGoogleCalendarResponse as GoogleCalendarResponse,
} from "@loam/shared/google/googleAccount";
import { StoreError } from "@loam/storage/storeError";

/*
 * What a plugin granted google:calendar may ask of Google: a request to the Calendar API
 * (`https://www.googleapis.com/calendar/v3/...`) and nothing else. The main process adds the
 * bearer token, so the plugin never holds it, and this check keeps that token from going
 * anywhere but the Calendar API. Only If-Match and If-None-Match pass from the plugin's
 * headers, and the body is JSON sent as it is.
 */

/** Request headers a plugin may set; the token and everything else are the main process's. */
const ALLOWED_HEADERS = new Set(["if-match", "if-none-match"]);
/** Response headers the plugin needs: the version for its next write, and how long to wait. */
const RETURNED_HEADERS = ["etag", "retry-after", "content-type"];

const refused = (message: string) => new StoreError(message, "PLUGIN_NOT_ALLOWED", 403);

/**
 * The Calendar API address `request` names, or a refusal: a path that leaves the API's root
 * (`..`, encoded slashes, another host through `//` or a backslash), or anything but a path.
 */
export const calendarRequestUrl = (calendarRoot: string, request: GoogleCalendarRequest) => {
  const { path } = request;
  if (typeof path !== "string" || !path.startsWith("/") || path.length > 2048)
    throw refused("A Calendar API path starts with /.");
  if (
    /[?#\\]/.test(path) ||
    path.includes("//") ||
    /%(?:2f|5c|2e)/i.test(path) ||
    path.split("/").some((segment) => segment === "." || segment === "..") ||
    // Control characters and spaces never belong in a path Google serves.
    [...path].some((character) => character <= " " || character === "\u007f")
  )
    throw refused("That Calendar API path is not allowed.");
  const url = new URL(`${calendarRoot}${path}`);
  const root = new URL(calendarRoot);
  if (url.origin !== root.origin || !url.pathname.startsWith(`${root.pathname}/`))
    throw refused("Only the Google Calendar API can be reached.");
  for (const [key, value] of Object.entries(request.query ?? {})) {
    for (const item of Array.isArray(value) ? value : [value])
      url.searchParams.append(key, String(item));
  }
  return url;
};

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

/** Sends a checked request with the bearer token; redirects come back as they are. */
export const sendCalendarRequest = async ({
  fetch: fetchImpl = fetch,
  calendarRoot,
  request,
  accessToken,
}: {
  fetch?: typeof fetch;
  calendarRoot: string;
  request: GoogleCalendarRequest;
  accessToken: string;
}): Promise<GoogleCalendarResponse> => {
  const url = calendarRequestUrl(calendarRoot, request);
  if (request.body && Buffer.byteLength(request.body) > MAX_BODY_BYTES)
    throw new StoreError("The request body is over 1 MB.", "PLUGIN_TOO_LARGE", 413);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers ?? {}))
    if (ALLOWED_HEADERS.has(name.toLowerCase())) headers[name.toLowerCase()] = value;
  headers.authorization = `Bearer ${accessToken}`;
  headers.accept = "application/json";
  if (request.body !== undefined) headers["content-type"] = "application/json";
  const response = await fetchImpl(url, {
    method: request.method ?? "GET",
    headers,
    body: request.body,
    redirect: "manual",
    credentials: "omit",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.byteLength;
    if (size > MAX_RESPONSE_BYTES)
      throw new StoreError("Google's answer is over 10 MB.", "PLUGIN_TOO_LARGE", 413);
    chunks.push(chunk);
  }
  return {
    status: response.status,
    headers: Object.fromEntries(
      RETURNED_HEADERS.flatMap((name) => {
        const value = response.headers.get(name);
        return value === null ? [] : [[name, value]];
      }),
    ),
    body: new TextDecoder().decode(Buffer.concat(chunks)),
  };
};
