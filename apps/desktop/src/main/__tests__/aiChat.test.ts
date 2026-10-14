import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { AiChatEvent, AiChatItem, AiChatStatus } from "@loam/shared/ai/aiChat";
import { createDataKey } from "@loam/storage/encryption/seal";
import {
  createNote,
  createTestStore,
  noteId,
  paragraph,
  text,
} from "@loam/storage/testing/storeFixtures";

import { createChatTools, lineDiff } from "../ai/chatTools";
import { PROVIDERS } from "../ai/providers/catalog";
import { describeCliTool } from "../ai/providers/cli";
import { createCliProvider } from "../ai/providers/cliProvider";
import type { ToolAnswer, TurnRequest } from "../ai/providers/types";
import { createAiService } from "../ai/service";
import { htmlToText } from "../ai/webRead";
import { createMcpTools, type ToolDefinition } from "../mcp/tools";
import { BRIDGE_PARAMS } from "../requests/params";
import { createTestApp } from "./appFixture";

/** The keychain Electron picked; "basic_text" is Linux without one. */
const keychain = { backend: "gnome_libsecret" };

// The operating system's keychain: reversible, but never the key as written.
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => keychain.backend,
    encryptString: (value: string) => Buffer.from(`sealed:${value}`).reverse(),
    decryptString: (value: Buffer) => Buffer.from(value).reverse().toString().slice(7),
  },
}));

/** The steps the scripted model takes in its next turn: tool calls, then a reply. */
type Step =
  | { tool: string; input: Record<string, unknown> }
  | { say: string }
  /** The provider asks to run one of its own tools, such as a command. */
  | { own: string; access: "read" | "web" | "outside" }
  /** The provider says how many tokens the conversation takes up. */
  | { usage: number };

const script: {
  turns: Step[][];
  seen: TurnRequest[];
  answers: ToolAnswer[];
  approvals: boolean[];
} = { turns: [], seen: [], answers: [], approvals: [] };

vi.mock("../ai/providers/anthropic", () => ({
  createAnthropicProvider: () => ({
    async runTurn(request: TurnRequest) {
      script.seen.push(request);
      for (const step of script.turns.shift() ?? []) {
        if ("say" in step) request.io.text(step.say);
        else if ("usage" in step) request.io.usage(step.usage);
        else if ("own" in step) {
          const allowed = await request.io.approve({
            tool: step.own,
            access: step.access,
            label: `Ran ${step.own}`,
            preview: null,
          });
          script.approvals.push(allowed);
          if (allowed)
            request.io.activity({
              key: step.own,
              tool: step.own,
              access: step.access,
              label: `Ran ${step.own}`,
              status: "done",
            });
        } else {
          request.io.endText();
          script.answers.push(await request.io.callTool(step.tool, step.input));
        }
      }
      request.io.endText();
      return { provider: "anthropic", model: request.model, messages: [] };
    },
  }),
}));

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0)) await dispose();
  script.turns = [];
  script.seen = [];
  script.answers = [];
  script.approvals = [];
});

const setup = async ({ key = null as ReturnType<typeof createDataKey> | null } = {}) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "loam-ai-"));
  const store = await createTestStore();
  const { app, dispatch } = await createTestApp(store, {
    workspace: {
      flush: async () => undefined,
      // The window's Markdown parser: a paragraph per line.
      request: async (command) => {
        if (command.action !== "parseMarkdown") throw new Error("Not in this test.");
        return command.text.split("\n").map((line) => paragraph(text(line)));
      },
      respond: () => undefined,
      close: () => undefined,
    },
  });
  let tools: ToolDefinition[] = [];
  tools = createMcpTools({ dispatch, app });
  const events: AiChatEvent[] = [];
  const statuses: AiChatStatus[] = [];
  const open = () =>
    createAiService({
      dataDirectory,
      version: "test",
      chatTools: createChatTools({ dispatch, workspace: app.workspace, tools: () => tools }),
      libraryKey: () => key,
      send: { status: (status) => statuses.push(status), event: (event) => events.push(event) },
    });
  const ai = await open();
  cleanup.push(async () => {
    await ai.close();
    await store.close();
    await rm(dataDirectory, { recursive: true, force: true });
  });

  /** Waits until the chat's turn ends. */
  const settled = (threadId: string) =>
    vi.waitFor(async () => {
      const thread = await ai.thread(threadId);
      if (thread.running) throw new Error("Still running.");
      return thread;
    });
  /** Waits for the approval the turn is waiting on. */
  const pendingApproval = (threadId: string) =>
    vi.waitFor(async () => {
      const approval = (await ai.thread(threadId)).items.find(
        (item): item is Extract<AiChatItem, { kind: "approval" }> =>
          item.kind === "approval" && item.status === "pending",
      );
      if (!approval) throw new Error("No approval yet.");
      return approval;
    });
  const actions = async (threadId: string) =>
    (await ai.thread(threadId)).items.filter(
      (item): item is Extract<AiChatItem, { kind: "action" }> => item.kind === "action",
    );
  const bodyText = async (id: string) =>
    JSON.stringify((await store.getNote(id)).blocksByTab["tab-1"]);
  const enable = async () => {
    await ai.configure({ enabled: true });
    await ai.setKey("anthropic", "sk-ant-secret-1234");
  };
  return {
    ai,
    open,
    store,
    events,
    statuses,
    dataDirectory,
    settled,
    pendingApproval,
    actions,
    bodyText,
    enable,
  };
};

const send = (
  ai: Awaited<ReturnType<typeof setup>>["ai"],
  text: string,
  options: { mode?: "supervised" | "auto-accept-edits" | "full-access"; plan?: boolean } = {},
  threadId: string | null = null,
) =>
  ai.send({
    threadId,
    text,
    context: null,
    mode: options.mode ?? "full-access",
    plan: options.plan ?? false,
  });

describe("side chat", () => {
  it("is off until turned on, and never hands an API key back", async () => {
    const { ai, enable, statuses } = await setup();
    expect((await ai.status()).enabled).toBe(false);
    await expect(send(ai, "Hello")).rejects.toMatchObject({ code: "FORBIDDEN" });

    await enable();
    const status = await ai.status();
    expect(status.enabled).toBe(true);
    expect(status.providers.find((provider) => provider.id === "anthropic")).toMatchObject({
      ready: true,
      detail: "Key ending in 1234",
    });
    expect(JSON.stringify([status, statuses])).not.toContain("sk-ant-secret");
  });

  it("refuses to keep a key where the computer can't really encrypt it", async () => {
    const { ai } = await setup();
    await ai.configure({ enabled: true });
    keychain.backend = "basic_text";
    try {
      await expect(ai.setKey("anthropic", "sk-ant-secret-1234")).rejects.toThrow(
        "can't encrypt the key",
      );
    } finally {
      keychain.backend = "gnome_libsecret";
    }
    const anthropic = (await ai.status()).providers.find(({ id }) => id === "anthropic");
    expect(anthropic).toMatchObject({ detail: "No key saved" });
  });

  it("forgets a service's key when its address changes", async () => {
    const { ai, dataDirectory } = await setup();
    await ai.configure({ enabled: true, baseUrl: "https://llm.example.com/v1" });
    await ai.setKey("openai-compatible", "sk-service-5678");
    await ai.configure({ baseUrl: "https://llm.example.com/v1" });
    const keyOf = async () =>
      (await ai.status()).providers.find(({ id }) => id === "openai-compatible")?.detail;
    expect(await keyOf()).toBe("Key ending in 5678");

    await ai.configure({ baseUrl: "https://elsewhere.example.net/v1" });
    expect(await keyOf()).toBe("No key saved");
    expect(await readFile(join(dataDirectory, "ai-keys.json"), "utf8")).not.toContain(
      "openai-compatible",
    );
  });

  it("keeps API keys encrypted on disk", async () => {
    const { enable, dataDirectory } = await setup();
    await enable();
    const saved = await readFile(join(dataDirectory, "ai-keys.json"), "utf8");
    expect(saved).not.toContain("sk-ant-secret");
  });

  it("streams the reply and saves the chat", async () => {
    const { ai, enable, settled, events } = await setup();
    await enable();
    script.turns.push([{ say: "Hello " }, { say: "there." }]);
    const { threadId } = await send(ai, "Say hello");
    const thread = await settled(threadId);
    expect(thread.title).toBe("Say hello");
    expect(thread.items.map((item) => item.kind)).toEqual(["user", "assistant"]);
    expect(thread.items[1]).toMatchObject({ text: "Hello there.", streaming: false });
    expect(events.filter((event) => event.type === "delta").map((event) => event.text)).toEqual([
      "Hello ",
      "there.",
    ]);
    expect(await ai.list()).toEqual([expect.objectContaining({ id: threadId, running: false })]);
  });

  it("in full access, changes notes without asking, and undoes each change", async () => {
    const { ai, enable, settled, actions, bodyText, store } = await setup();
    await enable();
    const id = noteId(1);
    await createNote(store, id, { title: "Plans" });
    script.turns.push([
      { tool: "loam_notes_write", input: { noteId: id, markdown: "Ship it" } },
      { tool: "loam_notes_new", input: { title: "Follow-ups", markdown: "Call Ana" } },
    ]);
    const { threadId } = await send(ai, "Update my plans");
    await settled(threadId);
    expect(await bodyText(id)).toContain("Ship it");
    const [edit, create] = await actions(threadId);
    expect(edit).toMatchObject({ label: "Edited Plans", status: "done", undoable: true });
    expect(create).toMatchObject({ label: "Created Follow-ups", status: "done", undoable: true });
    expect((await store.getLibrary()).notes).toHaveLength(2);

    await ai.undo(threadId, [create!.id, edit!.id]);
    expect(await bodyText(id)).toContain("Body");
    expect(await bodyText(id)).not.toContain("Ship it");
    expect((await store.getLibrary()).notes.map((note) => note.id)).toEqual([id]);
    expect((await actions(threadId)).map((action) => action.status)).toEqual(["undone", "undone"]);
  });

  it("in supervised mode, asks first and leaves the note alone when declined", async () => {
    const { ai, enable, settled, pendingApproval, bodyText, store } = await setup();
    await enable();
    const id = noteId(1);
    await createNote(store, id, { title: "Plans" });
    script.turns.push([{ tool: "loam_notes_write", input: { noteId: id, markdown: "Ship it" } }]);
    const { threadId } = await send(ai, "Update", { mode: "supervised" });
    const approval = await pendingApproval(threadId);
    expect(approval).toMatchObject({ label: "Edited Plans", access: "edit" });
    expect(approval.preview).toContain("+ Ship it");
    expect(await bodyText(id)).not.toContain("Ship it");

    ai.respond(threadId, approval.id, "decline");
    await settled(threadId);
    expect(await bodyText(id)).not.toContain("Ship it");
    expect(script.answers).toEqual([{ content: "The user declined this change.", isError: true }]);
  });

  it("stops asking for a kind of change once it is accepted for the chat", async () => {
    const { ai, enable, settled, pendingApproval, bodyText, store } = await setup();
    await enable();
    const id = noteId(1);
    await createNote(store, id, { title: "Plans" });
    script.turns.push([
      { tool: "loam_notes_write", input: { noteId: id, markdown: "One" } },
      { tool: "loam_notes_write", input: { noteId: id, markdown: "Two" } },
    ]);
    const { threadId } = await send(ai, "Update", { mode: "supervised" });
    ai.respond(threadId, (await pendingApproval(threadId)).id, "accept-for-chat");
    const thread = await settled(threadId);
    expect(thread.items.filter((item) => item.kind === "approval")).toHaveLength(1);
    expect(await bodyText(id)).toContain("Two");
  });

  it("in auto-accept edits, edits freely but asks before creating notes", async () => {
    const { ai, enable, pendingApproval, settled, bodyText, store } = await setup();
    await enable();
    const id = noteId(1);
    await createNote(store, id, { title: "Plans" });
    script.turns.push([
      { tool: "loam_notes_write", input: { noteId: id, markdown: "Edited" } },
      { tool: "loam_notes_new", input: { title: "New one" } },
    ]);
    const { threadId } = await send(ai, "Go", { mode: "auto-accept-edits" });
    const approval = await pendingApproval(threadId);
    expect(approval).toMatchObject({ access: "organize", label: "Created New one" });
    expect(await bodyText(id)).toContain("Edited");
    ai.respond(threadId, approval.id, "accept");
    await settled(threadId);
    expect((await store.getLibrary()).notes).toHaveLength(2);
  });

  it("applies a mode change to the turn's next step", async () => {
    const { ai, enable, pendingApproval, settled, store } = await setup();
    await enable();
    await createNote(store, noteId(1), { title: "Plans" });
    script.turns.push([
      { tool: "loam_notes_new", input: { title: "First" } },
      { tool: "loam_notes_new", input: { title: "Second" } },
    ]);
    const { threadId } = await send(ai, "Go", { mode: "supervised" });
    const approval = await pendingApproval(threadId);
    await ai.setMode(threadId, "full-access", false);
    ai.respond(threadId, approval.id, "accept");
    const thread = await settled(threadId);
    expect(thread.items.filter((item) => item.kind === "approval")).toHaveLength(1);
    expect((await store.getLibrary()).notes).toHaveLength(3);
  });

  it("in plan mode, offers only reading tools", async () => {
    const { ai, enable, settled, store } = await setup();
    await enable();
    const id = noteId(1);
    await createNote(store, id, { title: "Plans" });
    script.turns.push([
      { tool: "loam_notes_read", input: { noteId: id } },
      { tool: "loam_notes_write", input: { noteId: id, markdown: "Nope" } },
    ]);
    const { threadId } = await send(ai, "Plan it", { plan: true });
    await settled(threadId);
    const offered = script.seen[0]!.tools;
    expect(offered.every((tool) => tool.access === "read" || tool.access === "web")).toBe(true);
    expect(script.seen[0]!.system).toContain("Plan mode is on");
    expect(JSON.parse(script.answers[0]!.content)).toMatchObject({
      title: "Plans",
      tabs: [expect.objectContaining({ markdown: "Body" })],
    });
    expect(script.answers[1]).toMatchObject({ isError: true });
    expect(JSON.stringify((await store.getNote(id)).blocksByTab)).not.toContain("Nope");
  });

  it("stops a turn that is waiting on an approval", async () => {
    const { ai, enable, pendingApproval, settled, store } = await setup();
    await enable();
    await createNote(store, noteId(1), { title: "Plans" });
    script.turns.push([{ tool: "loam_notes_new", input: { title: "Never" } }]);
    const { threadId } = await send(ai, "Go", { mode: "supervised" });
    await pendingApproval(threadId);
    ai.stop(threadId);
    const thread = await settled(threadId);
    expect(thread.items.find((item) => item.kind === "approval")).toMatchObject({
      status: "declined",
    });
    expect((await store.getLibrary()).notes).toHaveLength(1);
  });

  it("asks before the provider acts outside Loam, unless the chat has full access", async () => {
    const { ai, enable, pendingApproval, settled } = await setup();
    await enable();
    script.turns.push([
      { own: "ls", access: "outside" },
      { own: "read", access: "read" },
    ]);
    const { threadId } = await send(ai, "List files", { mode: "auto-accept-edits" });
    const approval = await pendingApproval(threadId);
    expect(approval).toMatchObject({ access: "outside", label: "Ran ls" });
    ai.respond(threadId, approval.id, "decline");
    const thread = await settled(threadId);
    expect(script.approvals).toEqual([false, true]);
    expect(thread.items.find((item) => item.kind === "approval")).toMatchObject({
      status: "declined",
    });
    expect(thread.items.filter((item) => item.kind === "action").map((item) => item.label)).toEqual(
      ["Ran read"],
    );

    script.turns.push([{ own: "ls", access: "outside" }]);
    await send(ai, "Again", { mode: "full-access" }, threadId);
    await settled(threadId);
    expect(script.approvals).toEqual([false, true, true]);
  });

  it("asks before reaching the web in supervised mode, and not in auto-accept edits", async () => {
    const { ai, enable, pendingApproval, settled } = await setup();
    await enable();
    script.turns.push([{ own: "WebFetch", access: "web" }]);
    const { threadId } = await send(ai, "Read a page", { mode: "supervised" });
    const approval = await pendingApproval(threadId);
    expect(approval).toMatchObject({ access: "web", label: "Ran WebFetch" });
    ai.respond(threadId, approval.id, "decline");
    await settled(threadId);

    script.turns.push([{ own: "WebFetch", access: "web" }]);
    await send(ai, "Again", { mode: "auto-accept-edits" }, threadId);
    await settled(threadId);
    expect(script.approvals).toEqual([false, true]);
  });

  it("sends files with a message: images and PDFs as they are, other files as text", async () => {
    const key = createDataKey();
    const { ai, enable, settled, dataDirectory } = await setup({ key });
    await enable();
    script.turns.push([{ say: "Got them." }]);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const pdf = new TextEncoder().encode("%PDF-1.7 lecture");
    const notes = new TextEncoder().encode("# Reading list\n- Campbell");
    const { threadId } = await ai.send({
      threadId: null,
      text: "",
      context: null,
      mode: "full-access",
      plan: false,
      attachments: [
        { name: "chart.png", bytes: png, text: null },
        { name: "Lecture 3.pdf", bytes: pdf, text: "Osmosis moves water" },
        { name: "reading.md", bytes: notes, text: null },
      ],
    });
    const thread = await settled(threadId);

    expect(thread.title).toBe("chart.png, Lecture 3.pdf, reading.md");
    const message = thread.items[0] as Extract<AiChatItem, { kind: "user" }>;
    expect(message.attachments?.map(({ name, kind }) => [name, kind])).toEqual([
      ["chart.png", "image"],
      ["Lecture 3.pdf", "pdf"],
      ["reading.md", "text"],
    ]);
    const [request] = script.seen;
    expect(request!.prompt).toBe("Look at the attached files.");
    expect(request!.attachments.map(({ kind, mimeType, text }) => [kind, mimeType, text])).toEqual([
      ["image", "image/png", null],
      ["pdf", "application/pdf", "Osmosis moves water"],
      ["text", "text/plain", "# Reading list\n- Campbell"],
    ]);
    expect([...request!.attachments[0]!.data]).toEqual([...png]);

    // The files are kept sealed, and read back for the chat to show them.
    const [, , readingList] = message.attachments!;
    const stored = await readFile(join(dataDirectory, "ai-chat-files", threadId, readingList!.id));
    expect(stored.toString("utf8")).not.toContain("Reading list");
    expect(new TextDecoder().decode(await ai.attachment(threadId, readingList!.id))).toContain(
      "Campbell",
    );

    await ai.remove(threadId);
    await expect(readdir(join(dataDirectory, "ai-chat-files"))).resolves.toEqual([]);
  });

  it("passes the chosen effort and the notes the message names", async () => {
    const { ai, enable, settled } = await setup();
    await enable();
    await ai.configure({ effort: "xhigh" });
    script.turns.push([{ say: "Compared." }]);
    const { threadId } = await ai.send({
      threadId: null,
      text: "Compare @Reading list",
      context: {
        noteId: null,
        noteTitle: null,
        selection: null,
        mentions: [{ noteId: "11111111-1111-4111-8111-111111111111", title: "Reading list" }],
      },
      mode: "full-access",
      plan: false,
    });
    await settled(threadId);
    const [request] = script.seen;
    expect(request!.effort).toBe("xhigh");
    expect(request!.prompt).toContain(
      '- "Reading list" (noteId 11111111-1111-4111-8111-111111111111)',
    );
    expect(request!.prompt).toMatch(/Compare @Reading list$/);
  });

  it("keeps how full the model's context is with the chat", async () => {
    const { ai, enable, settled } = await setup();
    await enable();
    script.turns.push([{ usage: 12_000 }, { say: "Done." }, { usage: 45_000 }]);
    const { threadId } = await send(ai, "Plan my week");
    const thread = await settled(threadId);
    expect(thread.context).toEqual({ tokens: 45_000, window: 1_000_000 });
  });

  it("dictates only with an OpenAI key", async () => {
    const { ai, enable } = await setup();
    await enable();
    expect((await ai.status()).canDictate).toBe(false);
    await expect(ai.transcribe(new Uint8Array([1]), "audio/webm")).rejects.toMatchObject({
      status: 403,
    });
  });

  it("refuses files a model can't read", async () => {
    const { ai, enable } = await setup();
    await enable();
    const send = (name: string, bytes: Uint8Array, text: string | null = null) =>
      ai.send({
        threadId: null,
        text: "Look",
        context: null,
        mode: "full-access",
        plan: false,
        attachments: [{ name, bytes, text }],
      });
    await expect(send("app.exe", new Uint8Array([0x4d, 0x5a, 0, 0]))).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      send("Empty.docx", new TextEncoder().encode("PK\u0003\u0004 word/document.xml")),
    ).rejects.toMatchObject({ status: 400 });
    expect(script.seen).toEqual([]);
    expect(await ai.list()).toEqual([]);
  });

  it("seals saved chats with the library's key", async () => {
    const key = createDataKey();
    const { ai, enable, settled, open, dataDirectory } = await setup({ key });
    await enable();
    script.turns.push([{ say: "A private reply" }]);
    const { threadId } = await send(ai, "Something private");
    await settled(threadId);
    const files = await readdir(join(dataDirectory, "ai-chats"));
    const saved = await readFile(join(dataDirectory, "ai-chats", files[0]!), "utf8");
    expect(saved).not.toContain("Something private");
    expect(JSON.parse(saved)).toHaveProperty("loamSealed", key.id);

    const reopened = await open();
    expect((await reopened.thread(threadId)).items[1]).toMatchObject({ text: "A private reply" });
    await reopened.close();
  });
});

describe("web page text", () => {
  it("keeps the readable text and drops scripts, styles and tags", () => {
    expect(
      htmlToText(
        "<html><head><style>p{}</style><script>alert(1)</script></head><body><h1>Title</h1><p>One &amp; two&#33;</p><p>Three</p></body></html>",
      ),
    ).toBe("Title\nOne & two!\nThree");
  });
});

describe("CLI tool labels", () => {
  it("names commands and file edits as acting outside Loam, and reading as reading", () => {
    expect(describeCliTool("Bash", { command: "ls -la" })).toMatchObject({
      label: "Ran ls -la",
      access: "outside",
    });
    expect(
      describeCliTool("Edit", { file_path: "/a.txt", old_string: "x", new_string: "y" }),
    ).toMatchObject({ label: "Edited /a.txt", access: "outside", preview: "- x\n+ y" });
    expect(describeCliTool("WebSearch", { query: "lisbon" })).toMatchObject({
      label: 'Searched the web for "lisbon"',
      access: "web",
    });
    expect(describeCliTool("WebFetch", { url: "https://example.com" })).toMatchObject({
      access: "web",
    });
  });

  it("reads files freely only in the turn's own folder", () => {
    const folder = join(tmpdir(), "loam-chat-turn");
    expect(describeCliTool("Read", { file_path: join(folder, "a.txt") }, folder)).toMatchObject({
      access: "read",
    });
    for (const file_path of [
      join(tmpdir(), "elsewhere.txt"),
      join(folder, "..", "loam-chat-turn-other", "a.txt"),
      "a.txt",
    ])
      expect(describeCliTool("Read", { file_path }, folder), file_path).toMatchObject({
        access: "outside",
      });
    expect(describeCliTool("Grep", { pattern: "key", path: folder }, folder)).toMatchObject({
      access: "read",
    });
    expect(describeCliTool("Grep", { pattern: "key" }, folder)).toMatchObject({
      access: "outside",
    });
    expect(describeCliTool("Glob", { pattern: "**/*" })).toMatchObject({ access: "outside" });
  });

  it("treats a tool it doesn't know as acting outside Loam", () => {
    expect(describeCliTool("SomethingNew", {})).toMatchObject({
      label: "Used SomethingNew",
      access: "outside",
    });
  });
});

describe("model ids", () => {
  it("takes the ids providers use, and nothing a shell would read", () => {
    const configure = BRIDGE_PARAMS["ai.configure"];
    const models = [
      ...Object.values(PROVIDERS).flatMap((provider) => provider.models),
      "gpt-5.1",
      "ft:gpt-4o-mini:acme:notes:abc123",
      "meta-llama/Llama-3.3-70B-Instruct",
      "llama3.2:3b",
      "opus[1m]",
      "",
    ];
    for (const model of models) expect(configure.safeParse({ model }).success, model).toBe(true);
    for (const model of ["gpt & calc", "a b", "x;y", "%PATH%", 'm"', "x|y", "a".repeat(201)])
      expect(configure.safeParse({ model }).success, model).toBe(false);
  });

  it("refuses to start a CLI with a model id that isn't one", async () => {
    const provider = createCliProvider({
      name: "claude",
      path: "/nonexistent/claude",
      chatMcp: { open: () => Promise.reject(new Error("Not reached.")) } as never,
    });
    await expect(provider.runTurn({ model: "opus & calc" } as TurnRequest)).rejects.toThrow(
      "isn't a model id",
    );
  });
});

describe("line diff", () => {
  it("shows added and removed lines with a little context", () => {
    expect(lineDiff("a\nb\nc", "a\nB\nc")).toBe("  a\n- b\n+ B\n  c");
  });
});
