import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import { StoreError } from "@loam/storage/storeError";

import { createLoamMcpServer } from "../mcp/server";
import type { ToolDefinition } from "../mcp/tools";
import type { ChatTool } from "./chatTools";
import type { TurnIO } from "./providers/types";

const MAX_REQUEST_BYTES = 20 * 1024 * 1024;

type Session = {
  tools: ChatTool[];
  io: TurnIO;
  /**
   * Answers the CLI's own permission prompts (Claude Code's
   * --permission-prompt-tool): true lets the CLI use the tool.
   */
  permission?: (request: { toolName: string; input: Record<string, unknown> }) => Promise<boolean>;
};

/** The tool Claude Code asks before using one of its own tools. */
export const PERMISSION_TOOL = "loam_permission";

/**
 * A private MCP endpoint for the CLIs the side chat runs. Each turn gets its
 * own key that ends with the turn, and reaches only that turn's tools, each
 * call going through the chat's access mode and approvals. It is separate
 * from AI access in Settings and runs only while a CLI turn does.
 */
export const createChatMcp = ({ version }: { version: string }) => {
  const sessions = new Map<string, Session>();
  let listening: Promise<{ server: Server; port: number }> | null = null;

  const sessionFor = (authorization: string | undefined) => {
    const given = Buffer.from(authorization ?? "");
    for (const [token, session] of sessions) {
      const expected = Buffer.from(`Bearer ${token}`);
      if (given.length === expected.length && timingSafeEqual(given, expected)) return session;
    }
    return null;
  };

  const listen = () =>
    (listening ??= new Promise((resolve, reject) => {
      const server = createServer((request, response) => {
        void (async () => {
          const session = sessionFor(request.headers.authorization);
          if (!session || request.url !== "/mcp" || request.method !== "POST") {
            response.writeHead(session ? 404 : 401).end();
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of request) {
            size += (chunk as Buffer).length;
            if (size > MAX_REQUEST_BYTES) {
              response.writeHead(413).end();
              return;
            }
            chunks.push(chunk as Buffer);
          }
          const tools: ToolDefinition[] = session.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: {
              readOnlyHint: tool.access === "read" || tool.access === "web",
              destructiveHint: tool.access === "organize",
              openWorldHint: false,
            },
            run: async (input) => {
              const answer = await session.io.callTool(tool.name, input);
              if (answer.isError) throw new StoreError(answer.content, "TOOL_ERROR", 400);
              try {
                return JSON.parse(answer.content) as unknown;
              } catch {
                return answer.content;
              }
            },
          }));
          const mcp = createLoamMcpServer({ tools, version });
          const { permission } = session;
          if (permission)
            mcp.registerTool(
              PERMISSION_TOOL,
              {
                description: "Asks the user whether the assistant may use one of its own tools.",
                inputSchema: {
                  tool_name: z.string(),
                  input: z.record(z.string(), z.unknown()),
                  tool_use_id: z.string().optional(),
                },
              },
              async ({ tool_name, input }) => {
                const allowed = await permission({ toolName: tool_name, input });
                // The answer Claude Code expects, as the text of the result.
                const answer = allowed
                  ? { behavior: "allow", updatedInput: input }
                  : { behavior: "deny", message: "The user declined this." };
                return { content: [{ type: "text", text: JSON.stringify(answer) }] };
              },
            );
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
          });
          response.once("close", () => void mcp.close().catch(() => undefined));
          await mcp.connect(transport);
          await transport.handleRequest(
            request,
            response,
            JSON.parse(Buffer.concat(chunks).toString("utf8")),
          );
        })().catch(() => {
          if (!response.headersSent) response.writeHead(500);
          response.end();
        });
      });
      // A turn may wait a long time on the user's approval.
      server.requestTimeout = 0;
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () =>
        resolve({ server, port: (server.address() as AddressInfo).port }),
      );
    }));

  return {
    /** Opens access for one turn; the returned `close` ends it. */
    async open(session: Session) {
      const { port } = await listen();
      const token = randomBytes(32).toString("hex");
      sessions.set(token, session);
      return { url: `http://127.0.0.1:${port}/mcp`, token, close: () => sessions.delete(token) };
    },
    async close() {
      sessions.clear();
      const current = await listening?.catch(() => null);
      listening = null;
      if (!current) return;
      await new Promise<void>((resolve) => {
        current.server.close(() => resolve());
        current.server.closeAllConnections();
      });
    },
  };
};

export type ChatMcp = ReturnType<typeof createChatMcp>;
