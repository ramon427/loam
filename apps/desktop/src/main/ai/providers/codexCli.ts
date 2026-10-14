import type { AiAccessMode } from "@loam/shared/ai/aiChat";

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
import { threeLevelEffort } from "./types";

/**
 * Codex's sandbox for the chat's access mode. Run this way, Codex can't stop
 * to ask, so modes that would ask keep it from changing anything.
 */
const codexSandbox = (mode: AiAccessMode) => {
  if (mode === "supervised") return "read-only";
  return mode === "full-access" ? "danger-full-access" : "workspace-write";
};

/** What Codex did with its own tools, from one of its items. */
const codexActivity = (item: Record<string, unknown>) => {
  if (item.type === "command_execution")
    return {
      tool: "command_execution",
      ...describeCliTool("command_execution", item),
      failed: typeof item.exit_code === "number" && item.exit_code !== 0,
    };
  if (item.type === "file_change") {
    const changes = Array.isArray(item.changes) ? (item.changes as Array<{ path?: string }>) : [];
    return {
      tool: "file_change",
      label: `Changed ${
        changes
          .map((change) => change.path)
          .filter(Boolean)
          .join(", ") || "files"
      }`,
      access: "outside" as const,
      preview: null,
      failed: item.status === "failed",
    };
  }
  if (item.type === "web_search")
    return { tool: "web_search", ...describeCliTool("web_search", item), failed: false };
  return null;
};

/**
 * Runs one turn with Codex: Loam's tools through the turn's endpoint, its own
 * in a sandbox the chat's access mode picks. Returns the session to resume
 * next turn.
 */
export const runCodexTurn = async ({
  path,
  workDirectory,
  files,
  endpoint,
  system,
  prompt,
  model,
  effort,
  mode,
  sessionId: resumed,
  io,
}: CliTurn) => {
  let sessionId = resumed;
  let turnError: string | null = null;
  const { code, stderr } = await run(
    path,
    [
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--ignore-user-config",
      "-C",
      workDirectory,
      "--sandbox",
      codexSandbox(mode),
      "-c",
      'approval_policy="never"',
      "-c",
      `mcp_servers.loam.url="${endpoint.url}"`,
      "-c",
      'mcp_servers.loam.bearer_token_env_var="LOAM_CHAT_MCP_TOKEN"',
      "-c",
      `mcp_servers.loam.tool_timeout_sec=${APPROVAL_WAIT_MS / 1000}`,
      // Connectors stay out, and pages open in Loam's browser, which the user can watch.
      ...["apps", "browser_use", "computer_use", "in_app_browser"].flatMap((feature) => [
        "-c",
        `features.${feature}=false`,
      ]),
      // Codex can't stop to ask, so a chat that asks before reaching the web
      // searches OpenAI's cached index, which never contacts the sites.
      "-c",
      `web_search="${mode === "supervised" ? "cached" : "live"}"`,
      // Codex looks at images it is handed, beside reading the files named in the prompt.
      ...files.flatMap(({ path, kind }) => (kind === "image" ? ["-i", path] : [])),
      ...(effort ? ["-c", `model_reasoning_effort="${threeLevelEffort(effort)}"`] : []),
      ...(model ? ["-m", model] : []),
      ...(sessionId ? ["resume", sessionId] : []),
      "-",
    ],
    {
      cwd: workDirectory,
      // Codex has no separate system prompt here; the first message carries it.
      input: sessionId ? prompt : `${system}\n\n---\n\n${prompt}`,
      env: { LOAM_CHAT_MCP_TOKEN: endpoint.token },
      signal: io.signal,
      onLine: (line) => {
        const message = parseLine(line);
        if (!message) return;
        if (
          message.type === "thread.started" &&
          typeof message.thread_id === "string" &&
          SESSION_ID.test(message.thread_id)
        )
          sessionId = message.thread_id;
        const item = message.item as Record<string, unknown> | undefined;
        if (item && (message.type === "item.started" || message.type === "item.completed")) {
          const finished = message.type === "item.completed";
          if (item.type === "agent_message" && finished) {
            io.text(typeof item.text === "string" ? item.text : "");
            io.endText();
          }
          const activity = codexActivity(item);
          if (activity)
            io.activity({
              key: String(item.id),
              tool: activity.tool,
              access: activity.access,
              label: activity.label,
              status: !finished ? "running" : activity.failed ? "failed" : "done",
              error: activity.failed ? "It didn't succeed." : null,
            });
        }
        if (message.type === "turn.completed") io.usage(contextTokensOf(message));
        if (message.type === "turn.failed" || message.type === "error") {
          const error = message.error as { message?: string } | undefined;
          turnError =
            error?.message ?? (typeof message.message === "string" ? message.message : "");
        }
      },
    },
  );
  io.endText();
  if (!io.signal.aborted && (code !== 0 || turnError !== null))
    throw failure("codex", stderr, turnError);
  return sessionId;
};
