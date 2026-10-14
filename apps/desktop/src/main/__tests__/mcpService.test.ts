import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { connectionFileSchema } from "../mcp/connectionFile";
import { createMcpService, type McpService } from "../mcp/service";
import type { ToolDefinition } from "../mcp/tools";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});
const freePort = async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
};
const setup = async (
  run: ToolDefinition["run"] = async () => ({ version: "test", storageAdapter: "memory" }),
) => {
  const directory = await mkdtemp(join(tmpdir(), "loam-mcp-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const appInfo = vi.fn(run);
  const tools: ToolDefinition[] = [
    {
      name: "loam_app_info",
      description: "Read the running app version.",
      inputSchema: z.strictObject({}),
      annotations: { readOnlyHint: true },
      run: appInfo,
    },
  ];
  const service = await createMcpService({
    dataDirectory: directory,
    version: "test",
    tools: () => tools,
  });
  cleanup.push(() => service.close());
  return { service, directory, appInfo };
};
const credentials = async (service: McpService) => {
  const connection = await service.connection();
  return JSON.parse(connection.config).mcpServers["loam"] as {
    url: string;
    headers: { Authorization: string };
  };
};

const rawStatus = (url: string, headers: Record<string, string>) =>
  new Promise<number>((resolve, reject) => {
    const request = httpRequest(url, { headers }, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    request.once("error", reject);
    request.end();
  });

describe("local MCP service", () => {
  it("revokes requests that authenticated before rotation but finish uploading afterwards", async () => {
    const { service, appInfo } = await setup();
    await service.configure({ enabled: true, port: await freePort() });
    const config = await credentials(service);
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "loam_app_info", arguments: {} },
    });
    let request: ReturnType<typeof httpRequest>;
    const response = new Promise<string>((resolve, reject) => {
      request = httpRequest(
        config.url,
        {
          method: "POST",
          headers: {
            ...config.headers,
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
          },
        },
        (incoming) => {
          let result = "";
          incoming.on("data", (chunk: Buffer) => {
            result += chunk.toString();
          });
          incoming.once("end", () => resolve(result));
        },
      );
      request.once("error", reject);
      request.write(body.slice(0, -1));
    });
    // A round trip lets the first request reach the authenticated upload reader.
    expect(await rawStatus(config.url, config.headers)).toBe(405);
    await service.rotateToken();
    request!.end(body.slice(-1));
    expect(JSON.parse(await response)).toMatchObject({
      result: { isError: true, structuredContent: { error: { code: "FORBIDDEN" } } },
    });
    expect(appInfo).not.toHaveBeenCalled();
  });
  it("starts off, persists private consent, and restarts on the same endpoint", async () => {
    const { service, directory } = await setup();
    expect(service.status()).toMatchObject({ enabled: false, running: false, url: null });
    const port = await freePort();
    expect(await service.configure({ enabled: true, port })).toMatchObject({ running: true, port });
    const before = await credentials(service);
    if (process.platform !== "win32") {
      expect((await stat(join(directory, "mcp.json"))).mode & 0o777).toBe(0o600);
      expect((await stat(join(directory, "mcp-connection.json"))).mode & 0o777).toBe(0o600);
    }
    await service.close();
    const reopened = await createMcpService({
      dataDirectory: directory,
      version: "test",
      tools: () => [],
    });
    cleanup.push(() => reopened.close());
    expect(reopened.status().running).toBe(true);
    expect(await credentials(reopened)).toEqual(before);
  });

  it("initializes and calls tools with a real Streamable HTTP client", async () => {
    const { service, appInfo } = await setup();
    await service.configure({ enabled: true, port: await freePort() });
    const config = await credentials(service);
    const client = new Client({ name: "integration", version: "1.0" });
    cleanup.push(() => client.close());
    await client.connect(
      new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: { headers: config.headers },
      }),
    );
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(["loam_app_info"]);
    const result = await client.callTool({ name: "loam_app_info", arguments: {} });
    expect(result.structuredContent).toMatchObject({ data: { version: "test" } });
    expect(appInfo).toHaveBeenCalledOnce();
    expect(JSON.stringify(await client.listTools())).not.toContain(config.headers.Authorization);
  });

  it("rejects missing tokens, hostile hosts/origins, query tokens and unsupported HTTP methods", async () => {
    const { service, appInfo } = await setup();
    await service.configure({ enabled: true, port: await freePort() });
    const config = await credentials(service);
    expect(
      (
        await fetch(config.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(401);
    expect(await rawStatus(config.url, { ...config.headers, Host: "attacker.example" })).toBe(403);
    expect(
      (
        await fetch(config.url, {
          headers: { ...config.headers, Origin: "https://attacker.example" },
        })
      ).status,
    ).toBe(403);
    expect((await fetch(`${config.url}?token=secret`, { headers: config.headers })).status).toBe(
      404,
    );
    expect((await fetch(config.url, { headers: config.headers })).status).toBe(405);
    expect(
      (await fetch(config.url, { method: "POST", headers: config.headers, body: "{}" })).status,
    ).toBe(415);
    expect(
      (
        await fetch(config.url, {
          method: "POST",
          headers: { ...config.headers, "Content-Type": "application/json" },
          body: "not json",
        })
      ).status,
    ).toBe(400);
    expect(appInfo).not.toHaveBeenCalled();
  });

  it("revokes an old key immediately and keeps stdio credentials outside client arguments", async () => {
    const { service, directory } = await setup();
    await service.configure({ enabled: true, port: await freePort() });
    const old = await credentials(service);
    const rotated = await service.rotateToken();
    expect((await fetch(old.url, { headers: old.headers })).status).toBe(401);
    const next = await credentials(service);
    expect(next.headers.Authorization).not.toBe(old.headers.Authorization);
    expect((await fetch(next.url, { headers: next.headers })).status).toBe(405);
    expect(rotated.stdioConfig).not.toContain(next.headers.Authorization.slice(7));
    expect(JSON.parse(await readFile(join(directory, "mcp-connection.json"), "utf8")).token).toBe(
      next.headers.Authorization.slice(7),
    );
    await service.configure({ enabled: false });
    expect(service.status()).toMatchObject({ enabled: false, running: false, url: null });
    await expect(fetch(next.url)).rejects.toThrow();
  });

  it("turns off at once while an AI call is still running", async () => {
    let finish = () => {};
    const { service, appInfo } = await setup(
      () => new Promise((resolve) => (finish = () => resolve(null))),
    );
    await service.configure({ enabled: true, port: await freePort() });
    const config = await credentials(service);
    const client = new Client({ name: "slow", version: "1.0" });
    cleanup.push(() => client.close());
    await client.connect(
      new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: { headers: config.headers },
      }),
    );
    const running = client.callTool({ name: "loam_app_info", arguments: {} }).catch(() => null);
    await vi.waitFor(() => expect(appInfo).toHaveBeenCalled());
    await expect(service.configure({ enabled: false })).resolves.toMatchObject({
      running: false,
    });
    finish();
    await running;
  });

  it("writes a connection file the stdio connector accepts, which points only at this app", async () => {
    const { service, directory } = await setup();
    await service.configure({ enabled: true, port: await freePort() });
    const file = JSON.parse(await readFile(join(directory, "mcp-connection.json"), "utf8"));
    expect(connectionFileSchema.parse(file)).toEqual(file);
    expect(file.url).toBe(service.status().url);
    for (const url of [
      "http://localhost:47821/mcp",
      "https://127.0.0.1:47821/mcp",
      "http://127.0.0.1:47821/other",
      "http://127.0.0.1:47821/mcp?token=x",
      "http://user:secret@127.0.0.1:47821/mcp",
      "http://127.0.0.1/mcp",
    ])
      expect(connectionFileSchema.safeParse({ ...file, url }).success, url).toBe(false);
  });

  it("reports a port collision without opening public interfaces or failing the app", async () => {
    const { service } = await setup();
    const occupied = createServer();
    await new Promise<void>((resolve) => occupied.listen(0, "127.0.0.1", resolve));
    cleanup.push(() => new Promise<void>((resolve) => occupied.close(() => resolve())));
    const port = (occupied.address() as { port: number }).port;
    expect(await service.configure({ enabled: true, port })).toMatchObject({
      enabled: true,
      running: false,
      error: expect.stringContaining("already in use"),
    });
  });
});
