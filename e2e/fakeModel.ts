import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

const readBody = async (request: IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A model service that speaks OpenAI's Chat Completions, for the side chat to
 * talk to: it lists one model, and answers each message by streaming `reply`
 * a word at a time after `thinkMs`. `requests` holds what each turn sent.
 */
export async function startFakeModel({
  reply,
  thinkMs = 0,
  wordMs = 0,
}: {
  reply: string;
  thinkMs?: number;
  wordMs?: number;
}) {
  const requests: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
  const server = createServer((request, response) => {
    void (async () => {
      if (request.url?.endsWith("/models")) {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ object: "list", data: [{ id: "fake-model", created: 1 }] }));
        return;
      }
      requests.push(JSON.parse(await readBody(request)));
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      const send = (value: unknown) => response.write(`data: ${JSON.stringify(value)}\n\n`);
      await wait(thinkMs);
      for (const word of reply.split(/(?<= )/)) {
        send({ choices: [{ index: 0, delta: { content: word } }] });
        await wait(wordMs);
      }
      send({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
      send({ choices: [], usage: { prompt_tokens: 1200, completion_tokens: 80 } });
      response.end("data: [DONE]\n\n");
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
