/**
 * Loam's sync server: a Cloudflare Worker that keeps sync files in an R2
 * bucket for the computers that hold its key. It stores files and nothing
 * else; Loam treats every file it reads as untrusted, and seals them before
 * they leave the computer while the notes are encrypted.
 *
 *   GET    /v1/list?prefix=devices/   every path under the prefix, with an ETag
 *   GET    /v1/files/<path>           a file
 *   PUT    /v1/files/<path>           replaces a file
 *   DELETE /v1/files/<path>           removes a file
 *
 * Each write also replaces a stamp, so a listing whose stamp hasn't changed
 * answers 304 for the price of one small read: computers look for changes
 * every half minute, and a full listing is billed per thousand files.
 */

/** The parts of an R2 bucket the server uses. */
export type SyncBucket = {
  get(key: string): Promise<{ body: ReadableStream; size: number; text(): Promise<string> } | null>;
  put(key: string, value: ReadableStream | ArrayBuffer | string | null): Promise<unknown>;
  delete(key: string): Promise<void>;
  list(options: {
    prefix: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ objects: { key: string }[]; truncated: boolean; cursor?: string }>;
};

export type SyncServerEnv = { BUCKET: SyncBucket; SYNC_KEY: string };

/** Replaced on every write; not a path a client can name, since paths can't start with ".". */
const STAMP = ".stamp";
/** Paths Loam writes: ids, clocks and media names, separated by "/". */
const SEGMENT = /^[A-Za-z0-9_~-][A-Za-z0-9._~-]{0,199}$/;
const MAX_PATH_LENGTH = 512;
/** Cloudflare refuses larger requests before they reach the Worker. */
const MAX_FILE_BYTES = 100 * 1024 * 1024;

const isPath = (path: string, { prefix = false } = {}) => {
  if (path.length === 0 || path.length > MAX_PATH_LENGTH) return prefix && path === "";
  const segments = path.split("/");
  if (prefix) {
    if (segments.pop() !== "") return false;
  }
  return segments.every((segment) => SEGMENT.test(segment));
};

const encoder = new TextEncoder();

/** Compares digests, so how long the comparison takes says nothing about the key. */
const keyMatches = async (given: string, expected: string) => {
  const [left, right] = await Promise.all(
    [given, expected].map(
      async (value) => new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))),
    ),
  );
  let difference = 0;
  for (let index = 0; index < left!.length; index += 1)
    difference |= left![index]! ^ right![index]!;
  return difference === 0;
};

const text = (status: number, body: string) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

const listAll = async (bucket: SyncBucket, prefix: string) => {
  const paths: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
    for (const { key } of page.objects) if (!key.startsWith(".")) paths.push(key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return paths;
};

const stamp = async (bucket: SyncBucket) =>
  `"${(await (await bucket.get(STAMP))?.text()) ?? "none"}"`;

export const handleRequest = async (request: Request, env: SyncServerEnv): Promise<Response> => {
  if (!env.SYNC_KEY) return text(500, "The server has no SYNC_KEY secret.");
  const authorization = request.headers.get("authorization") ?? "";
  const given = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!given || !(await keyMatches(given, env.SYNC_KEY))) return text(401, "Wrong sync code.");

  const url = new URL(request.url);
  const { BUCKET: bucket } = env;

  if (url.pathname === "/v1/list" && request.method === "GET") {
    const prefix = url.searchParams.get("prefix") ?? "";
    if (!isPath(prefix, { prefix: true })) return text(400, "Invalid prefix.");
    // Read before listing: a write in between changes the stamp, so the next listing is fresh.
    const etag = await stamp(bucket);
    const headers = { etag, "cache-control": "no-store" };
    if (request.headers.get("if-none-match") === etag)
      return new Response(null, { status: 304, headers });
    return Response.json({ paths: await listAll(bucket, prefix) }, { headers });
  }

  if (!url.pathname.startsWith("/v1/files/")) return text(404, "Not found.");
  let path: string;
  try {
    path = url.pathname.slice("/v1/files/".length).split("/").map(decodeURIComponent).join("/");
  } catch {
    return text(400, "Invalid path.");
  }
  if (!isPath(path)) return text(400, "Invalid path.");

  switch (request.method) {
    case "GET": {
      const file = await bucket.get(path);
      if (!file) return text(404, "Not found.");
      return new Response(file.body, {
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(file.size),
          "cache-control": "no-store",
        },
      });
    }
    case "PUT": {
      const length = Number(request.headers.get("content-length"));
      if (!Number.isFinite(length) || length > MAX_FILE_BYTES) return text(413, "Too large.");
      await bucket.put(path, request.body);
      await bucket.put(STAMP, crypto.randomUUID());
      return new Response(null, { status: 204 });
    }
    case "DELETE":
      await bucket.delete(path);
      await bucket.put(STAMP, crypto.randomUUID());
      return new Response(null, { status: 204 });
    default:
      return text(405, "Method not allowed.");
  }
};

export default { fetch: handleRequest };
