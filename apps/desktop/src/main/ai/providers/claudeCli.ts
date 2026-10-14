import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { AiAccessMode, AiToolAccess } from "@loam/shared/ai/aiChat";

import { PERMISSION_TOOL } from "../chatMcp";
import {
  APPROVAL_WAIT_MS,
  contextTokensOf,
  describeCliTool,
  failure,
  parseLine,
  run,
  SESSION_ID,
  type CliTurn,
} from "./cli";

/**
 * Claude Code's own tools that read this computer or reach the web. It runs
 * the read tools without asking inside its working folder, so these always
 * come to Loam, which decides by the chat's access mode.
 */
const ASKED_TOOLS = ["Read", "Grep", "Glob", "WebFetch", "WebSearch"];

/** Claude Code's permission mode for the chat's access mode. */
const claudePermissionMode = (mode: AiAccessMode) => {
  if (mode === "full-access") return "bypassPermissions";
  return mode === "auto-accept-edits" ? "acceptEdits" : "manual";
};

/** A tool result's text, for showing why it failed. */
const resultText = (content: unknown) =>
  (typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part) => (part as { text?: string }).text ?? "").join(" ")
      : ""
  ).slice(0, 300);

/**
 * Runs one turn with Claude Code: Loam's tools through the turn's endpoint,
 * and its own tools asking Loam (the permission tool) by the chat's access
 * mode. Returns the session to resume next turn.
 */
export const runClaudeTurn = async ({
  path,
  workDirectory,
  scratch,
  endpoint,
  system,
  prompt,
  model,
  mode,
  sessionId: resumed,
  io,
}: CliTurn) => {
  let sessionId = resumed;
  /** Claude Code's own tool calls this turn, until their results come back. */
  const cliTools = new Map<string, { tool: string; label: string; access: AiToolAccess }>();
  const mcpConfig = join(scratch, "mcp.json");
  const systemFile = join(scratch, "system.md");
  const settingsFile = join(scratch, "settings.json");
  await writeFile(
    mcpConfig,
    JSON.stringify({
      mcpServers: {
        loam: {
          type: "http",
          url: endpoint.url,
          headers: { Authorization: `Bearer ${endpoint.token}` },
        },
      },
    }),
    { mode: 0o600 },
  );
  await writeFile(systemFile, system, { mode: 0o600 });
  await writeFile(settingsFile, JSON.stringify({ permissions: { ask: ASKED_TOOLS } }), {
    mode: 0o600,
  });
  let resultError: string | null = null;
  const { code, stderr } = await run(
    path,
    [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--mcp-config",
      mcpConfig,
      "--strict-mcp-config",
      "--allowedTools",
      "mcp__loam",
      "--permission-mode",
      claudePermissionMode(mode),
      "--permission-prompt-tool",
      `mcp__loam__${PERMISSION_TOOL}`,
      "--settings",
      settingsFile,
      "--append-system-prompt-file",
      systemFile,
      ...(model ? ["--model", model] : []),
      ...(sessionId ? ["--resume", sessionId] : []),
    ],
    {
      cwd: workDirectory,
      input: prompt,
      // Loam's tools may wait on the user's approval; the CLI waits as long as they take.
      env: { MCP_TOOL_TIMEOUT: String(APPROVAL_WAIT_MS) },
      signal: io.signal,
      onLine: (line) => {
        const message = parseLine(line);
        if (!message) return;
        if (typeof message.session_id === "string" && SESSION_ID.test(message.session_id))
          sessionId = message.session_id;
        if (message.type === "stream_event") {
          const event = message.event as {
            type?: string;
            delta?: { type?: string; text?: string };
            content_block?: { type?: string };
          };
          if (event.type === "content_block_delta" && event.delta?.type === "text_delta")
            io.text(event.delta.text ?? "");
          if (event.type === "content_block_start" && event.content_block?.type === "tool_use")
            io.endText();
        }
        // Its own tools show in the chat; Loam's tools show as they run.
        const content = (message.message as { content?: unknown } | undefined)?.content;
        if (!Array.isArray(content)) return;
        for (const block of content as Array<Record<string, unknown>>) {
          if (message.type === "assistant" && block.type === "tool_use") {
            const tool = String(block.name);
            if (tool.startsWith("mcp__loam__")) continue;
            const { label, access } = describeCliTool(
              tool,
              (block.input ?? {}) as Record<string, unknown>,
              scratch,
            );
            io.activity({ key: String(block.id), tool, access, label, status: "running" });
            cliTools.set(String(block.id), { tool, label, access });
          }
          if (message.type === "user" && block.type === "tool_result") {
            const started = cliTools.get(String(block.tool_use_id));
            if (!started) continue;
            io.activity({
              key: String(block.tool_use_id),
              ...started,
              status: block.is_error ? "failed" : "done",
              error: block.is_error ? resultText(block.content) : null,
            });
          }
        }
        if (message.type === "result" && message.is_error === true)
          resultError = typeof message.result === "string" ? message.result : "";
        if (message.type === "assistant") io.usage(contextTokensOf(message.message));
      },
    },
  );
  io.endText();
  if (!io.signal.aborted && (code !== 0 || resultError !== null))
    throw failure("claude", stderr, resultError);
  return sessionId;
};
