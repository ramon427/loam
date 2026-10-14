import { mkdtemp, realpath, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { AI_MODEL_ID } from "@loam/shared/ai/aiChat";

import type { ChatMcp } from "../chatMcp";
import type { ProviderHistory } from "../threads";
import { runClaudeTurn } from "./claudeCli";
import { describeCliTool, SESSION_ID, writeAttachments, type CliName } from "./cli";
import { runCodexTurn } from "./codexCli";
import type { ChatProvider, TurnRequest } from "./types";

/**
 * Runs the user's own CLI for each turn, signed in as they are, from their
 * home folder. It keeps its own tools (files, commands, the web) under the
 * chat's access mode, and reaches Loam's notes and browser through a private
 * endpoint for the turn. Connectors set up in the CLI stay out.
 */
export const createCliProvider = ({
  name,
  path,
  chatMcp,
  workDirectory = homedir(),
}: {
  name: CliName;
  path: string;
  chatMcp: ChatMcp;
  /** Where the CLI runs; its sessions are kept by folder. */
  workDirectory?: string;
}): ChatProvider => ({
  async runTurn({
    model,
    system,
    prompt: message,
    attachments,
    effort,
    tools,
    mode,
    history,
    io,
  }: TurnRequest) {
    if (model && !AI_MODEL_ID.test(model))
      throw new Error(`"${model.slice(0, 40)}" isn't a model id. Choose another in Settings.`);
    // Its real path, as the CLI names the files it reads there.
    const scratch = await realpath(await mkdtemp(join(tmpdir(), "loam-chat-")));
    // Files sent with the message wait in the turn's folder, where the CLI reads them.
    const files = await writeAttachments(scratch, attachments);
    const prompt =
      files.length > 0
        ? `${message}\n\nThe user attached these files; read them from here:\n${files.map(({ path }) => `- ${path}`).join("\n")}`
        : message;
    const endpoint = await chatMcp.open({
      tools,
      io,
      permission: async ({ toolName, input }) => {
        const { label, access, preview } = describeCliTool(toolName, input, scratch);
        return io.approve({ tool: toolName, access, label, preview });
      },
    });
    let sessionId =
      history?.sessionId && SESSION_ID.test(history.sessionId) ? history.sessionId : null;
    try {
      sessionId = await (name === "claude" ? runClaudeTurn : runCodexTurn)({
        path,
        workDirectory,
        scratch,
        files,
        endpoint,
        system,
        prompt,
        model,
        effort,
        mode,
        sessionId,
        io,
      });
    } finally {
      endpoint.close();
      await rm(scratch, { recursive: true, force: true });
    }
    const next: ProviderHistory = {
      provider: name === "claude" ? "claude-cli" : "codex-cli",
      model,
      ...(sessionId ? { sessionId } : {}),
    };
    return next;
  },
});
