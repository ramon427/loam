import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import type { BridgeMcpConnection, BridgeMcpStatus } from "@loam/shared/bridge/loamBridge";
import { StoreError } from "@loam/storage/storeError";

import { writeJsonFile } from "../jsonFiles";
import { connectionTokenSchema, connectionUrl, type ConnectionFile } from "./connectionFile";
import { createLoamMcpServer } from "./server";
import type { ToolDefinition } from "./tools";

const DEFAULT_PORT = 47821;
const MAX_REQUEST_BYTES = 20 * 1024 * 1024;
const settingsSchema = z
  .object({
    enabled: z.boolean(),
    port: z.number().int().min(1024).max(65535),
    token: connectionTokenSchema,
  })
  .strict();
type Settings = z.infer<typeof settingsSchema>;
const newToken = () => randomBytes(32).toString("hex");

const respondError = (response: ServerResponse, status: number, message: string, code = -32000) => {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code, message } }));
};

/** Runs work one call at a time, in order; a failure doesn't stop what follows. */
const oneAtATime = () => {
  let tail: Promise<unknown> = Promise.resolve();
  const run = <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work);
    tail = result.catch(() => undefined);
    return result;
  };
  return Object.assign(run, { idle: () => tail });
};

const hasToken = (request: IncomingMessage, token: string) => {
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(request.headers.authorization ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

/**
 * AI access: a local MCP endpoint, off until the user turns it on in
 * Settings, that answers only with the connection key. Settings and keys live
 * in private files outside notes, backups and sync.
 */
export const createMcpService = async ({
  dataDirectory,
  version,
  tools,
  stdioCommand = "node",
  stdioArgs = [],
  stdioEnv,
}: {
  dataDirectory: string;
  version: string;
  tools: () => readonly ToolDefinition[];
  stdioCommand?: string;
  stdioArgs?: string[];
  stdioEnv?: Record<string, string>;
}) => {
  const settingsPath = join(dataDirectory, "mcp.json");
  const connectionPath = join(dataDirectory, "mcp-connection.json");
  let settings: Settings = { enabled: false, port: DEFAULT_PORT, token: newToken() };
  let error: string | null = null;
  let listener: Server | null = null;
  // AI calls run one at a time; so do changes to the settings.
  const execute = oneAtATime();
  const configureOnce = oneAtATime();
  const active = new Set<ReturnType<typeof createLoamMcpServer>>();
  try {
    settings = settingsSchema.parse(JSON.parse(await readFile(settingsPath, "utf8")));
  } catch (failure) {
    if ((failure as NodeJS.ErrnoException).code !== "ENOENT")
      error = "AI access configuration could not be read. Set up AI access again in Settings.";
  }

  const status = (): BridgeMcpStatus => ({
    enabled: settings.enabled,
    running: listener?.listening ?? false,
    port: settings.port,
    url: listener?.listening ? connectionUrl(settings.port) : null,
    error,
  });
  const connection = (): BridgeMcpConnection => ({
    config: JSON.stringify(
      {
        mcpServers: {
          loam: {
            url: connectionUrl(settings.port),
            headers: { Authorization: `Bearer ${settings.token}` },
          },
        },
      },
      null,
      2,
    ),
    stdioConfig: JSON.stringify(
      {
        mcpServers: {
          loam: {
            command: stdioCommand,
            args: [...stdioArgs, "--config", connectionPath],
            ...(stdioEnv ? { env: stdioEnv } : {}),
          },
        },
      },
      null,
      2,
    ),
    configPath: connectionPath,
  });
  const persist = async () => {
    await mkdir(dataDirectory, { recursive: true });
    await writeJsonFile(settingsPath, settings, { private: true });
    const file: ConnectionFile = { url: connectionUrl(settings.port), token: settings.token };
    await writeJsonFile(connectionPath, file, { private: true });
  };
  /**
   * Stops listening without waiting for AI calls: one running finishes on its
   * own, and queued ones are refused (see `requireAccess`).
   */
  const stop = async () => {
    const server = listener;
    listener = null;
    if (!server) return;
    await Promise.allSettled([...active].map((mcp) => mcp.close()));
    active.clear();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  };

  const start = async () => {
    if (!settings.enabled || listener) return;
    const server = createServer((request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      void (async () => {
        const requestToken = settings.token;
        const origin = request.headers.origin;
        const hosts = [`127.0.0.1:${settings.port}`, `localhost:${settings.port}`];
        if (
          !hosts.includes(request.headers.host ?? "") ||
          (origin !== undefined && !hosts.some((host) => origin === `http://${host}`))
        )
          return respondError(response, 403, "Host or origin is not allowed.");
        if (!hasToken(request, requestToken))
          return respondError(response, 401, "A valid Loam connection key is required.");
        if (request.url !== "/mcp") return respondError(response, 404, "Not found.");
        if (request.method !== "POST") {
          response.setHeader("Allow", "POST");
          return respondError(response, 405, "Use POST for this stateless MCP endpoint.");
        }
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] ?? ""))
          return respondError(response, 415, "MCP requests require application/json.");
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of request) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += bytes.length;
          if (size > MAX_REQUEST_BYTES)
            return respondError(response, 413, "MCP requests must be 20 MB or smaller.");
          chunks.push(bytes);
        }
        let body: unknown;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          return respondError(response, 400, "Invalid JSON.", -32700);
        }
        const requireAccess = () => {
          if (listener !== server || settings.token !== requestToken)
            throw new StoreError(
              "AI access was turned off or its connection key changed.",
              "FORBIDDEN",
              403,
            );
        };
        const mcp = createLoamMcpServer({
          tools: tools(),
          version,
          execute: (work) =>
            execute(async () => {
              requireAccess();
              return work();
            }),
        });
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        active.add(mcp);
        response.once("close", () => {
          active.delete(mcp);
          void mcp.close().catch(() => undefined);
        });
        await mcp.connect(transport);
        await transport.handleRequest(request, response, body);
      })().catch(() => {
        if (!response.headersSent)
          respondError(response, 500, "The MCP request could not be completed.", -32603);
        else response.end();
      });
    });
    server.requestTimeout = 30_000;
    server.headersTimeout = 10_000;
    server.maxConnections = 32;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(settings.port, "127.0.0.1", () => {
          server.removeListener("error", reject);
          resolve();
        });
      });
      listener = server;
      error = null;
    } catch (failure) {
      const code = (failure as NodeJS.ErrnoException).code;
      error =
        code === "EADDRINUSE"
          ? `Port ${settings.port} is already in use. Choose another port.`
          : "The local MCP server could not start.";
      server.close();
    }
  };

  // A single saved consent controls startup, even while the library is locked.
  if (settings.enabled) {
    try {
      await persist();
      await start();
    } catch {
      error = "AI access configuration could not be saved. Check the data folder permissions.";
    }
  }
  return {
    status,
    async configure(update: { enabled: boolean; port?: number }) {
      return configureOnce(async () => {
        await stop();
        settings = { ...settings, ...update };
        await persist();
        error = null;
        await start();
        return status();
      });
    },
    /** The configurations to copy into a client; written now so stdio clients can read theirs. */
    async connection() {
      return configureOnce(async () => {
        await persist();
        return connection();
      });
    },
    async rotateToken() {
      return configureOnce(async () => {
        settings = { ...settings, token: newToken() };
        await persist();
        return connection();
      });
    },
    /** Stops, then waits for the AI call still running, so the notes can close after it. */
    async close() {
      await configureOnce.idle();
      await stop();
      await execute.idle();
    },
  };
};

export type McpService = Awaited<ReturnType<typeof createMcpService>>;
