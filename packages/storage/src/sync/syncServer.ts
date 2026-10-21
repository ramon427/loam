import { SyncFolderError } from "./syncFolder";
import type { SyncStorage } from "./syncStorage";

/**
 * Sync files on a sync server: a small Cloudflare Worker the user runs in
 * their own account over an R2 bucket (apps/sync-server). It stores files and
 * nothing else; every file is as untrusted as one in a sync folder.
 *
 * A sync code is the server's address with its access key after "#", like
 * https://loam-sync.name.workers.dev/#key, so a browser that opens it never
 * sends the key.
 */
export type SyncServer = { url: string; key: string };

const KEY_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
/** Cloudflare Workers take requests of up to 100 MB. */
const MAX_FILE_BYTES = 95 * 1024 * 1024;
/** A request that hasn't finished by then is retried by the next sync. */
const TIMEOUT_MS = 2 * 60_000;

/** The server a sync code names, or null when it isn't one. */
export const parseSyncCode = (code: string): SyncServer | null => {
  let url: URL;
  try {
    url = new URL(code.trim());
  } catch {
    return null;
  }
  const key = url.hash.slice(1);
  const secure =
    url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname));
  if (!secure || !KEY_PATTERN.test(key) || url.username || url.password || url.search) return null;
  return { url: `${url.origin}${url.pathname.replace(/\/+$/, "")}`, key };
};

/** What the status shows for a server: its host name, never its key. */
export const describeSyncServer = (server: SyncServer) => new URL(server.url).host;

const filePath = (path: string) => `files/${path.split("/").map(encodeURIComponent).join("/")}`;

const isPathList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((path) => typeof path === "string");

/**
 * The sync files on `server`. Listings are cached by the server's ETag, so
 * looking for other devices' changes costs one small read while nothing
 * changed: keep one storage per server across syncs.
 */
export const serverStorage = (server: SyncServer, fetchImpl: typeof fetch = fetch): SyncStorage => {
  const listings = new Map<string, { etag: string; paths: string[] }>();

  const request = async (path: string, init: RequestInit = {}) => {
    let response: Response;
    try {
      response = await fetchImpl(`${server.url}/v1/${path}`, {
        ...init,
        headers: { authorization: `Bearer ${server.key}`, ...init.headers },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new SyncFolderError(
        "Can't reach the sync server. Changes are kept here and sync once it's back.",
        { cause: error },
      );
    }
    if (response.status === 401)
      throw new SyncFolderError(
        "The sync server didn't accept this computer's sync code. Paste the current code in Settings › Sync.",
      );
    return response;
  };

  const failed = (response: Response) =>
    new SyncFolderError(
      `The sync server answered with an error (${response.status}). Changes are kept here and sync once it works again.`,
    );

  return {
    async list(prefix) {
      const cached = listings.get(prefix);
      const response = await request(`list?prefix=${encodeURIComponent(prefix)}`, {
        headers: cached ? { "if-none-match": cached.etag } : {},
      });
      if (response.status === 304 && cached) return cached.paths;
      if (!response.ok) throw failed(response);
      const body: unknown = await response.json().catch(() => null);
      const paths = (body as { paths?: unknown } | null)?.paths;
      if (!isPathList(paths))
        throw new SyncFolderError("The sync server sent a damaged list of files.");
      const etag = response.headers.get("etag");
      if (etag) listings.set(prefix, { etag, paths });
      else listings.delete(prefix);
      return paths;
    },

    async read(path, maxBytes) {
      const response = await request(filePath(path));
      if (response.status === 404) return null;
      if (!response.ok) throw failed(response);
      if (Number(response.headers.get("content-length")) > maxBytes) {
        await response.body?.cancel();
        return null;
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      return bytes.byteLength > maxBytes ? null : bytes;
    },

    async write(path, data) {
      const response = await request(filePath(path), {
        method: "PUT",
        body: data as RequestInit["body"],
      });
      if (!response.ok) throw failed(response);
    },

    async remove(path) {
      const response = await request(filePath(path), { method: "DELETE" });
      if (!response.ok && response.status !== 404) throw failed(response);
    },

    maxFileBytes: MAX_FILE_BYTES,
  };
};
