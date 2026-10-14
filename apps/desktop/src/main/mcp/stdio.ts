import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { connectionFileSchema } from "./connectionFile";

/** Stdio compatibility forwards to the running app; it never opens a second store. */
const run = async () => {
  const configIndex = process.argv.indexOf("--config");
  const path = configIndex >= 0 ? process.argv[configIndex + 1] : undefined;
  if (!path)
    throw new Error(
      "Use --config <absolute path to mcp-connection.json> from Loam Settings > AI access.",
    );
  const parsed = connectionFileSchema.safeParse(JSON.parse(await readFile(resolve(path), "utf8")));
  if (!parsed.success)
    throw new Error(
      parsed.error.issues[0]?.path[0] === "url"
        ? parsed.error.issues[0].message
        : "The connection configuration is damaged. Copy it again from Settings › AI access.",
    );
  const config = parsed.data;
  const url = new URL(config.url);
  const client = new Client({ name: "loam-stdio", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: `Bearer ${config.token}` } },
    }),
  );
  const capabilities = client.getServerCapabilities() ?? {};
  const server = new Server(client.getServerVersion() ?? { name: "loam", version: "1.0.0" }, {
    capabilities,
    instructions: client.getInstructions(),
  });
  server.setRequestHandler(ListToolsRequestSchema, (request) => client.listTools(request.params));
  server.setRequestHandler(CallToolRequestSchema, (request) => client.callTool(request.params));
  server.setRequestHandler(ListResourcesRequestSchema, (request) =>
    client.listResources(request.params),
  );
  server.setRequestHandler(ListResourceTemplatesRequestSchema, (request) =>
    client.listResourceTemplates(request.params),
  );
  server.setRequestHandler(ReadResourceRequestSchema, (request) =>
    client.readResource(request.params),
  );
  if (capabilities.prompts) {
    server.setRequestHandler(ListPromptsRequestSchema, (request) =>
      client.listPrompts(request.params),
    );
    server.setRequestHandler(GetPromptRequestSchema, (request) => client.getPrompt(request.params));
  }
  const close = async () => {
    await server.close();
    await client.close();
  };
  server.onclose = () => {
    void client.close();
  };
  process.once("SIGINT", () => {
    void close();
  });
  process.once("SIGTERM", () => {
    void close();
  });
  await server.connect(new StdioServerTransport());
};

void run().catch((error: unknown) => {
  process.stderr.write(
    `Loam MCP: ${error instanceof Error ? error.message : "Could not connect."}\n`,
  );
  process.exitCode = 1;
});
