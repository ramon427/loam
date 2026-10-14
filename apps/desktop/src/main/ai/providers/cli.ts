import { spawn } from "node:child_process";
import { access, constants, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, delimiter, isAbsolute, join, relative, sep } from "node:path";
import { createInterface } from "node:readline";

import type { AiToolAccess } from "@loam/shared/ai/aiChat";

import { lineDiff } from "../chatTools";
import type { TurnAttachment, TurnRequest } from "./types";

/** One turn as the CLI that runs it needs it, set up by `createCliProvider`. */
export type CliTurn = Pick<TurnRequest, "model" | "system" | "effort" | "mode" | "plan" | "io"> & {
  /** The CLI's executable. */
  path: string;
  /** Where the CLI runs. */
  workDirectory: string;
  /** The turn's own folder, removed after it. */
  scratch: string;
  /** The files sent with the message, written into `scratch`. */
  files: { path: string; kind: TurnAttachment["kind"] }[];
  /** The turn's endpoint for Loam's tools. */
  endpoint: { url: string; token: string };
  /** The message, naming the files sent with it. */
  prompt: string;
  /** The session to resume, if any. */
  sessionId: string | null;
};

/** The tokens a step's reported usage adds up to, from what was sent and what came back; 0 without one. */
export const contextTokensOf = (carrier: unknown) => {
  const usage = (carrier as { usage?: Record<string, unknown> } | undefined)?.usage;
  if (!usage) return 0;
  const count = (key: string) => (typeof usage[key] === "number" ? usage[key] : 0);
  // Codex counts cached input within input_tokens; Claude Code counts it apart.
  return (
    count("input_tokens") +
    count("cache_read_input_tokens") +
    count("cache_creation_input_tokens") +
    count("output_tokens")
  );
};

/**
 * Writes the turn's files into its folder under their own names, numbered
 * when two share one; Word documents and the like go as their text.
 */
export const writeAttachments = async (folder: string, attachments: readonly TurnAttachment[]) => {
  const used = new Set<string>();
  const written: { path: string; kind: TurnAttachment["kind"] }[] = [];
  for (const attachment of attachments) {
    const asText = attachment.kind === "text";
    const base = basename(attachment.name).replace(/[^\w.\- ]/g, "_") || "file";
    let name = asText && !/\.(txt|md|markdown|csv|json|log)$/i.test(base) ? `${base}.txt` : base;
    for (let number = 2; used.has(name); number++) name = `${number}-${base}`;
    used.add(name);
    const path = join(folder, name);
    await writeFile(path, asText ? (attachment.text ?? "") : attachment.data, { mode: 0o600 });
    written.push({ path, kind: attachment.kind });
  }
  return written;
};

export type CliName = "claude" | "codex";

/** A session id as the CLIs write them; anything else starts a new session. */
export const SESSION_ID = /^[\w-]{1,200}$/;

/** How long a CLI waits on one of Loam's tools, which may be waiting on the user's approval. */
export const APPROVAL_WAIT_MS = 24 * 60 * 60 * 1000;

/**
 * Where CLIs are usually installed. An app started from the desktop may not
 * have the shell's PATH, so these are searched as well.
 */
const extraDirectories = () => {
  const home = homedir();
  return process.platform === "win32"
    ? [join(process.env.APPDATA ?? "", "npm"), join(home, ".local", "bin")]
    : [
        join(home, ".local", "bin"),
        join(home, ".claude", "local"),
        join(home, ".npm-global", "bin"),
        join(home, ".bun", "bin"),
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
      ];
};

/** The CLI's executable, or null when it isn't installed. */
export const findCli = async (name: CliName): Promise<string | null> => {
  const names = process.platform === "win32" ? [`${name}.exe`, `${name}.cmd`] : [name];
  const directories = [...(process.env.PATH ?? "").split(delimiter), ...extraDirectories()];
  for (const directory of directories.filter(Boolean)) {
    for (const file of names) {
      const path = join(directory, file);
      try {
        await access(path, constants.X_OK);
        return path;
      } catch {
        // Not here; keep looking.
      }
    }
  }
  return null;
};

/** Runs `path` with `args`, giving it `input` on stdin, and calls `onLine` with each line it prints. */
export const run = (
  path: string,
  args: string[],
  {
    cwd,
    input,
    env,
    signal,
    onLine,
  }: {
    cwd: string;
    input: string;
    env?: Record<string, string>;
    signal?: AbortSignal;
    onLine?: (line: string) => void;
  },
) =>
  new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    const child = spawn(path, args, {
      cwd,
      env: { ...process.env, ...env },
      // Windows runs npm's .cmd shims only through the shell, which reads the
      // arguments as written: values from settings or history are checked
      // against AI_MODEL_ID and SESSION_ID first, and JSON goes in files.
      shell: process.platform === "win32" && path.endsWith(".cmd"),
      windowsHide: true,
    });
    let stderr = "";
    const stop = () => child.kill();
    signal?.addEventListener("abort", stop, { once: true });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-4000);
    });
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => onLine?.(line));
    child.on("error", reject);
    child.on("close", (code) => {
      signal?.removeEventListener("abort", stop);
      resolve({ code, stderr });
    });
    child.stdin.end(input);
  });

/** The CLI's version line, to show that it was found. */
export const cliVersion = async (path: string) => {
  let output = "";
  const { code } = await run(path, ["--version"], {
    cwd: tmpdir(),
    input: "",
    onLine: (line) => (output ||= line.trim()),
  });
  return code === 0 ? output : null;
};

export const parseLine = (line: string): Record<string, unknown> | null => {
  try {
    const value: unknown = JSON.parse(line);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** What the CLI said when it failed, without its noise. */
export const failure = (name: CliName, stderr: string, message: string | null) =>
  new Error(
    message?.trim() ||
      stderr.trim().split("\n").slice(-3).join("\n") ||
      `${name === "claude" ? "Claude Code" : "Codex"} stopped without replying. Check that it is signed in.`,
  );

/** Whether `path` is an absolute path inside `folder`. */
const isInside = (folder: string | null, path: string) => {
  if (!folder || !isAbsolute(path)) return false;
  const rest = relative(folder, path);
  return rest === "" || (!isAbsolute(rest) && rest.split(sep)[0] !== "..");
};

/**
 * How a CLI's own tool shows in the chat, and what kind of access it takes.
 * Files count as reading only inside `readable`, the turn's own folder;
 * anywhere else, and any tool not known here, count as acting outside Loam.
 */
export const describeCliTool = (
  tool: string,
  input: Record<string, unknown>,
  readable: string | null = null,
): { label: string; access: AiToolAccess; preview: string | null } => {
  const text = (key: string) => (typeof input[key] === "string" ? (input[key] as string) : "");
  switch (tool) {
    case "Bash":
    case "command_execution":
      return {
        label: `Ran ${text("command").split("\n")[0]!.slice(0, 120)}`,
        access: "outside",
        preview: text("command"),
      };
    case "Edit":
    case "MultiEdit":
      return {
        label: `Edited ${text("file_path")}`,
        access: "outside",
        preview: text("old_string") ? lineDiff(text("old_string"), text("new_string")) : null,
      };
    case "Write":
      return {
        label: `Wrote ${text("file_path")}`,
        access: "outside",
        preview: text("content").slice(0, 4000),
      };
    case "NotebookEdit":
      return { label: `Edited ${text("notebook_path")}`, access: "outside", preview: null };
    case "Read":
      return {
        label: `Read ${text("file_path")}`,
        access: isInside(readable, text("file_path")) ? "read" : "outside",
        preview: null,
      };
    case "Glob":
    case "Grep":
      return {
        label: `Searched files for ${text("pattern")}`,
        // Without a path they search the CLI's working folder.
        access: isInside(readable, text("path")) ? "read" : "outside",
        preview: text("path") || null,
      };
    case "WebSearch":
    case "web_search":
      return { label: `Searched the web for "${text("query")}"`, access: "web", preview: null };
    case "WebFetch":
      return { label: `Read ${text("url")}`, access: "web", preview: null };
    default:
      return { label: `Used ${tool}`, access: "outside", preview: null };
  }
};
