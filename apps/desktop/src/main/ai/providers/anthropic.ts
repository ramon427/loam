import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import type { ProviderHistory } from "../threads";
import {
  attachmentText,
  type ChatProvider,
  type ToolAnswer,
  type TurnAttachment,
  type TurnIO,
} from "./types";

/** Models that can hand a declined request to another model on the server. */
const FALLBACK_MODELS = new Set([
  "claude-fable-5-1",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-sonnet-5-5",
]);
const MAX_STEPS = 60;
/** Models with the web tools that filter results before reading them; others get the basic ones. */
const DYNAMIC_WEB_MODELS = new Set([
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-5-5",
  "claude-sonnet-5",
  "claude-sonnet-4-6",
]);

const webTools = (model: string): Anthropic.Beta.BetaToolUnion[] =>
  DYNAMIC_WEB_MODELS.has(model)
    ? [
        { type: "web_search_20260209", name: "web_search" },
        { type: "web_fetch_20260209", name: "web_fetch" },
      ]
    : [
        { type: "web_search_20250305", name: "web_search" },
        { type: "web_fetch_20250910", name: "web_fetch" },
      ];

/** Shows each web search or page read the model made, and how it went. */
const reportWebUse = (message: Anthropic.Beta.BetaMessage, io: TurnIO) => {
  for (const block of message.content) {
    if (block.type !== "server_tool_use") continue;
    if (block.name !== "web_search" && block.name !== "web_fetch") continue;
    const result = message.content.find(
      (entry) =>
        (entry.type === "web_search_tool_result" || entry.type === "web_fetch_tool_result") &&
        entry.tool_use_id === block.id,
    ) as
      | Anthropic.Beta.BetaWebSearchToolResultBlock
      | Anthropic.Beta.BetaWebFetchToolResultBlock
      | undefined;
    const content = result?.content as
      { type?: string; error_code?: string } | unknown[] | undefined;
    const error =
      content && !Array.isArray(content) && content.type?.endsWith("_error")
        ? (content.error_code ?? "failed")
        : null;
    const query = typeof block.input.query === "string" ? block.input.query : "";
    const url = typeof block.input.url === "string" ? block.input.url : "";
    io.activity({
      key: block.id,
      tool: block.name,
      access: "web",
      label: block.name === "web_search" ? `Searched the web for "${query}"` : `Read ${url}`,
      status: error ? "failed" : "done",
      error: error ? `The web tool answered ${error}.` : null,
    });
  }
};

/** A file sent with a message, as Claude reads it: an image or a PDF itself, anything else as text. */
const attachmentBlock = (attachment: TurnAttachment): Anthropic.Beta.BetaContentBlockParam => {
  const data = attachment.data.toString("base64");
  if (attachment.kind === "image")
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: attachment.mimeType as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
        data,
      },
    };
  if (attachment.kind === "pdf")
    return {
      type: "document",
      title: attachment.name,
      source: { type: "base64", media_type: "application/pdf", data },
    };
  return { type: "text", text: attachmentText(attachment) };
};

/**
 * Claude through the Anthropic API with the user's key. The chat keeps the
 * API's own messages, thinking blocks included, and sends them back as they
 * are.
 */
export const createAnthropicProvider = (apiKey: string): ChatProvider => {
  const client = new Anthropic({ apiKey });
  return {
    async runTurn({ model, system, prompt, attachments, effort, tools, history, io }) {
      const messages = [
        ...((history?.messages ?? []) as Anthropic.Beta.BetaMessageParam[]),
        {
          role: "user",
          content:
            attachments.length > 0
              ? [...attachments.map(attachmentBlock), { type: "text", text: prompt }]
              : prompt,
        } satisfies Anthropic.Beta.BetaMessageParam,
      ];
      const done = (): ProviderHistory => ({ provider: "anthropic", model, messages });
      const toolParams: Anthropic.Beta.BetaToolUnion[] = tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: z.toJSONSchema(tool.inputSchema, {
          io: "input",
          unrepresentable: "any",
        }) as Anthropic.Beta.BetaTool.InputSchema,
        eager_input_streaming: true,
      }));
      toolParams.push(...webTools(model));
      const fallback = FALLBACK_MODELS.has(model);

      for (let step = 0; step < MAX_STEPS; step++) {
        const stream = client.beta.messages.stream(
          {
            model,
            max_tokens: 64_000,
            system,
            tools: toolParams,
            messages,
            cache_control: { type: "ephemeral" },
            ...(effort ? { output_config: { effort } } : {}),
            ...(fallback
              ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
              : {}),
          },
          { signal: io.signal },
        );
        let message: Anthropic.Beta.BetaMessage;
        try {
          for await (const event of stream) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta")
              io.text(event.delta.text);
            if (event.type !== "content_block_start") continue;
            const block = event.content_block;
            if (block.type === "tool_use") io.endText();
            if (block.type === "server_tool_use") {
              io.endText();
              io.activity({
                key: block.id,
                tool: block.name,
                access: "web",
                label: block.name === "web_search" ? "Searching the web" : "Reading a page",
                status: "running",
              });
            }
          }
          message = await stream.finalMessage();
        } catch (error) {
          if (io.signal.aborted) return done();
          // A tool input the model left as broken JSON: ask for the step again.
          if (!(error instanceof Anthropic.APIError) && error instanceof SyntaxError) continue;
          throw error;
        }
        io.endText();
        const { usage } = message;
        io.usage(
          usage.input_tokens +
            (usage.cache_read_input_tokens ?? 0) +
            (usage.cache_creation_input_tokens ?? 0) +
            usage.output_tokens,
        );
        reportWebUse(message, io);
        messages.push({ role: "assistant", content: message.content });
        if (message.stop_reason === "refusal") throw new Error("The model declined this request.");
        if (message.stop_reason === "pause_turn") continue;
        const calls = message.content.filter(
          (block): block is Anthropic.Beta.BetaToolUseBlock => block.type === "tool_use",
        );
        if (calls.length === 0) return done();

        // Every call gets an answer, even when the turn stops, so the chat can continue later.
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const call of calls) {
          let answer: ToolAnswer;
          if (io.signal.aborted) answer = { content: "Stopped by the user.", isError: true };
          else if (message.stop_reason === "max_tokens")
            answer = {
              content: "The input was cut off. Make the change in smaller steps.",
              isError: true,
            };
          else answer = await io.callTool(call.name, call.input);
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: answer.content,
            is_error: answer.isError,
          });
        }
        messages.push({ role: "user", content: results });
        if (io.signal.aborted) return done();
      }
      throw new Error("The assistant took too many steps and stopped. Ask it to continue.");
    },
  };
};
