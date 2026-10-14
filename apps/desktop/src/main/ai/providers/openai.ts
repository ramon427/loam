import OpenAI, { toFile } from "openai";
import { z } from "zod";

import type { AiProviderId } from "@loam/shared/ai/aiChat";

import type { ProviderHistory } from "../threads";
import {
  attachmentText,
  threeLevelEffort,
  type ChatProvider,
  type TurnIO,
  type TurnAttachment,
} from "./types";

const MAX_STEPS = 60;

type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ContentPart = OpenAI.Chat.Completions.ChatCompletionContentPart;

/**
 * A file sent with a message: an image as an image; a PDF as a file for
 * OpenAI, which reads PDFs, and as its text for services that may not.
 */
const attachmentPart = (attachment: TurnAttachment, readsPdfs: boolean): ContentPart => {
  const dataUrl = `data:${attachment.mimeType};base64,${attachment.data.toString("base64")}`;
  if (attachment.kind === "image") return { type: "image_url", image_url: { url: dataUrl } };
  if (attachment.kind === "pdf" && readsPdfs)
    return { type: "file", file: { filename: attachment.name, file_data: dataUrl } };
  return { type: "text", text: attachmentText(attachment) };
};

type StreamedCall = { id: string; name: string; arguments: string };

/** Reads one step's stream: its text, shown as it arrives, and the tools it calls. */
const readStep = async (
  stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
  io: TurnIO,
) => {
  let text = "";
  const calls: StreamedCall[] = [];
  for await (const chunk of stream) {
    if (chunk.usage) io.usage(chunk.usage.prompt_tokens + chunk.usage.completion_tokens);
    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;
    if (delta.content) {
      text += delta.content;
      io.text(delta.content);
    }
    for (const call of delta.tool_calls ?? []) {
      io.endText();
      const entry = (calls[call.index] ??= { id: "", name: "", arguments: "" });
      if (call.id) entry.id = call.id;
      if (call.function?.name) entry.name += call.function.name;
      if (call.function?.arguments) entry.arguments += call.function.arguments;
    }
  }
  return { text, calls: calls.filter(Boolean) };
};

/** Runs a tool the model called; its answer is the tool message's content. */
const answer = async (call: StreamedCall, io: TurnIO) => {
  if (io.signal.aborted) return "Error: Stopped by the user.";
  let input: unknown;
  try {
    input = JSON.parse(call.arguments || "{}");
  } catch {
    return "The arguments were not valid JSON.";
  }
  const result = await io.callTool(call.name, input);
  return result.isError ? `Error: ${result.content}` : result.content;
};

/**
 * OpenAI, or any service that speaks its Chat Completions API (OpenRouter,
 * Ollama, LM Studio), with the user's key.
 */
export const createOpenAiProvider = ({
  provider,
  apiKey,
  baseUrl,
}: {
  provider: Extract<AiProviderId, "openai" | "openai-compatible">;
  apiKey: string;
  baseUrl: string | null;
}): ChatProvider => {
  const client = new OpenAI({ apiKey, ...(baseUrl ? { baseURL: baseUrl } : {}) });
  return {
    async runTurn({ model, system, prompt, attachments, effort, tools, history, io }) {
      const messages: Message[] = [
        ...((history?.messages ?? []) as Message[]),
        {
          role: "user",
          content:
            attachments.length > 0
              ? [
                  ...attachments.map((attachment) =>
                    attachmentPart(attachment, provider === "openai"),
                  ),
                  { type: "text", text: prompt },
                ]
              : prompt,
        },
      ];
      const done = (): ProviderHistory => ({ provider, model, messages });
      const toolParams: OpenAI.Chat.Completions.ChatCompletionTool[] = tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: z.toJSONSchema(tool.inputSchema, {
            io: "input",
            unrepresentable: "any",
          }) as Record<string, unknown>,
        },
      }));

      for (let step = 0; step < MAX_STEPS; step++) {
        let read: Awaited<ReturnType<typeof readStep>>;
        try {
          const stream = await client.chat.completions.create(
            {
              model,
              messages: [{ role: "system", content: system }, ...messages],
              tools: toolParams,
              stream: true,
              // OpenAI says how many tokens the step used at its end; other services may refuse the option.
              ...(provider === "openai" ? { stream_options: { include_usage: true } } : {}),
              // Only OpenAI's own reasoning models take an effort; other services may refuse it.
              ...(effort && provider === "openai"
                ? { reasoning_effort: threeLevelEffort(effort) }
                : {}),
            },
            { signal: io.signal },
          );
          read = await readStep(stream, io);
        } catch (error) {
          if (io.signal.aborted) return done();
          throw error;
        }
        io.endText();
        const { text, calls: toolCalls } = read;
        messages.push({
          role: "assistant",
          content: text || null,
          ...(toolCalls.length
            ? {
                tool_calls: toolCalls.map((call) => ({
                  id: call.id,
                  type: "function" as const,
                  function: { name: call.name, arguments: call.arguments },
                })),
              }
            : {}),
        });
        if (toolCalls.length === 0) return done();

        for (const call of toolCalls)
          messages.push({ role: "tool", tool_call_id: call.id, content: await answer(call, io) });
        if (io.signal.aborted) return done();
      }
      throw new Error("The assistant took too many steps and stopped. Ask it to continue.");
    },
  };
};

/** The account's chat models, newest first, for the model picker. */
export const listOpenAiModels = async (apiKey: string, baseUrl: string | null) => {
  const client = new OpenAI({ apiKey, ...(baseUrl ? { baseURL: baseUrl } : {}) });
  const models: Array<{ id: string; created: number }> = [];
  for await (const model of client.models.list()) models.push(model);
  return models
    .filter(
      (model) =>
        baseUrl !== null ||
        (/^(gpt|o\d)/.test(model.id) &&
          !/(audio|realtime|transcribe|tts|image|search|embedding)/.test(model.id)),
    )
    .sort((left, right) => right.created - left.created)
    .map((model) => model.id);
};

/** What a recording says, written by OpenAI's transcription model. */
export const transcribeSpeech = async (apiKey: string, audio: Uint8Array, mimeType: string) => {
  const client = new OpenAI({ apiKey });
  const extension = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "m4a" : "webm";
  const result = await client.audio.transcriptions.create({
    model: "gpt-4o-mini-transcribe",
    file: await toFile(audio, `speech.${extension}`, { type: mimeType }),
  });
  return result.text.trim();
};
