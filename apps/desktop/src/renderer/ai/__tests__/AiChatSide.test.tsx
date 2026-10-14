// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AiChatItem, AiChatStatus, AiThread } from "@loam/shared/ai/aiChat";

import { useShortcuts } from "../../keyboard/useShortcuts";
import { useAiChatStatus } from "../../settings/queries";
import { installFakeBridge } from "../../testing/fakeBridge";
import { AiChatOpenButton, AiChatSide, AiChatToggleProvider } from "../AiChatPanel";
import { useAiChatLayout } from "../useAiChatLayout";

const STATUS: AiChatStatus = {
  enabled: true,
  provider: "anthropic",
  model: "claude-sonnet",
  baseUrl: null,
  defaultMode: "supervised",
  effort: null,
  canDictate: false,
  providers: [
    {
      id: "anthropic",
      label: "Anthropic",
      kind: "api-key",
      ready: true,
      detail: "Key ending in 4f2a",
      models: [],
      experimental: false,
    },
  ],
  error: null,
};

const openNote = vi.fn();

/** The side chat as the window wires it: its status, its column, its shortcut and its button. */
function Shell() {
  const status = useAiChatStatus().data;
  const layout = useAiChatLayout(280);
  const enabled = status?.enabled === true;
  useShortcuts([{ id: "app.chat.toggle", enabled, allowInEditable: true, run: layout.toggle }]);
  return (
    <AiChatToggleProvider value={enabled ? { open: layout.open, onOpen: layout.openPanel } : null}>
      <main id="main-content">
        <AiChatOpenButton />
      </main>
      {status?.enabled ? (
        <AiChatSide
          layout={layout}
          status={status}
          activeNote={{ id: "note-1", title: "Weekly review" }}
          notes={[
            { id: "note-1", title: "Weekly review" },
            { id: "note-2", title: "Reading list" },
            { id: "note-3", title: "Recipes" },
          ]}
          onOpenNote={openNote}
          onOpenSettings={() => {}}
        />
      ) : null}
    </AiChatToggleProvider>
  );
}

const thread = (items: AiChatItem[], running = false): AiThread => ({
  id: "thread-1",
  title: "Review help",
  updatedAt: 1,
  createdAt: 1,
  running,
  mode: "supervised",
  plan: false,
  provider: "anthropic",
  model: "claude-sonnet",
  items,
});

const renderShell = ({ status = STATUS, threads = [] as AiThread[] } = {}) => {
  const bridge = installFakeBridge({
    "ai.status": () => status,
    "ai.threads": () =>
      threads.map(({ id, title, updatedAt, running }) => ({ id, title, updatedAt, running })),
    "ai.thread": ({ threadId }: { threadId: string }) =>
      threads.find((candidate) => candidate.id === threadId),
    "ai.send": () => ({ threadId: "thread-1" }),
    "ai.transcribe": () => ({ text: "Plan the week" }),
    "ai.configure": (change: Partial<AiChatStatus>) => ({ ...status, ...change }),
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Shell />
    </QueryClientProvider>,
  );
  return bridge;
};

const openChat = async () =>
  fireEvent.click(await screen.findByRole("button", { name: "Open side chat" }));

const toggleChat = () =>
  fireEvent.keyDown(document.body, { key: "j", ctrlKey: true, shiftKey: true });

/** Opens a saved chat from the list in the chat's header. */
const openSavedChat = async () => {
  await openChat();
  const panel = await screen.findByRole("complementary", { name: "Side chat" });
  const trigger = within(panel).getByRole("button", { name: /^Chats:/ });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(await screen.findByRole("menuitem", { name: /Review help/ }));
  return panel;
};

const user = (overrides: Partial<Extract<AiChatItem, { kind: "user" }>> = {}): AiChatItem => ({
  kind: "user",
  id: "u1",
  turnId: "t1",
  text: "Tidy my review",
  context: null,
  plan: false,
  at: 1,
  ...overrides,
});

beforeEach(() => {
  localStorage.clear();
  openNote.mockReset();
});

describe("AiChatSide", () => {
  it("stays hidden while the side chat is off", async () => {
    const { invoke } = renderShell({ status: { ...STATUS, enabled: false } });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("ai.status", {}));
    toggleChat();
    expect(screen.queryByRole("complementary", { name: "Side chat" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open side chat" })).toBeNull();
  });

  it("opens from its button and toggles with Ctrl+Shift+J", async () => {
    renderShell();
    fireEvent.click(await screen.findByRole("button", { name: "Open side chat" }));
    expect(await screen.findByRole("complementary", { name: "Side chat" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open side chat" })).toBeNull();

    toggleChat();
    await waitFor(() =>
      expect(screen.queryByRole("complementary", { name: "Side chat" })).toBeNull(),
    );
    toggleChat();
    expect(await screen.findByRole("complementary", { name: "Side chat" })).toBeTruthy();
  });

  it("sends a message with the open note and shows the streamed answer", async () => {
    const { invoke, emit } = renderShell();
    await openChat();
    const message = await screen.findByLabelText("Message");
    expect(screen.getByText(/Using: Weekly review/)).toBeTruthy();
    fireEvent.change(message, { target: { value: "Summarize this note" } });
    fireEvent.keyDown(message, { key: "Enter" });
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("ai.send", {
        threadId: null,
        text: "Summarize this note",
        context: { noteId: "note-1", noteTitle: "Weekly review", selection: null },
        mode: "supervised",
        plan: false,
      }),
    );

    act(() => {
      emit("ai.event", {
        type: "item",
        threadId: "thread-1",
        item: user({ text: "Summarize this note" }),
      });
      emit("ai.event", {
        type: "item",
        threadId: "thread-1",
        item: { kind: "assistant", id: "a1", turnId: "t1", text: "It covers ", streaming: true },
      });
      emit("ai.event", { type: "delta", threadId: "thread-1", itemId: "a1", text: "three goals." });
    });
    expect(await screen.findByText("It covers three goals.")).toBeTruthy();
    expect(screen.getByText("Writing…")).toBeTruthy();
  });

  it("shows it is thinking until the reply starts, then folds its steps into how long it worked", async () => {
    const { emit } = renderShell();
    await openChat();
    const message = await screen.findByLabelText("Message");
    fireEvent.change(message, { target: { value: "Tidy my review" } });
    fireEvent.keyDown(message, { key: "Enter" });
    const thread = {
      id: "thread-1",
      title: "Review help",
      updatedAt: 2,
      mode: "supervised" as const,
      plan: false,
    };
    act(() => {
      emit("ai.event", { type: "thread", thread: { ...thread, running: true } });
      emit("ai.event", { type: "item", threadId: "thread-1", item: user({ at: Date.now() }) });
    });
    expect(await screen.findByText("Thinking")).toBeTruthy();

    const step: AiChatItem = {
      kind: "action",
      id: "e1",
      turnId: "t1",
      tool: "loam_notes_update",
      access: "edit",
      label: "Edited Goals",
      noteId: null,
      status: "done",
      error: null,
      undoable: true,
    };
    act(() => {
      emit("ai.event", { type: "item", threadId: "thread-1", item: step });
      emit("ai.event", {
        type: "item",
        threadId: "thread-1",
        item: { kind: "assistant", id: "a1", turnId: "t1", text: "Done.", streaming: false },
      });
    });
    expect(screen.queryByText("Thinking")).toBeNull();
    expect(screen.getByText("Edited Goals")).toBeTruthy();

    act(() => emit("ai.event", { type: "thread", thread: { ...thread, running: false } }));
    expect(await screen.findByRole("button", { name: /^Worked for \d+s · 1 step$/ })).toBeTruthy();
    expect(screen.queryByText("Edited Goals")).toBeNull();
    expect(screen.getByText("Done.")).toBeTruthy();
  });

  it("asks a finished question again", async () => {
    const { invoke } = renderShell({
      threads: [
        thread([
          user(),
          { kind: "assistant", id: "a1", turnId: "t1", text: "Tidied.", streaming: false },
        ]),
      ],
    });
    await openSavedChat();
    expect(await screen.findByRole("button", { name: "Copy answer" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ask again" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "ai.send",
        expect.objectContaining({ threadId: "thread-1", text: "Tidy my review" }),
      ),
    );
  });

  it("sends attached files, and a long paste as a file of its own", async () => {
    const { invoke } = renderShell();
    await openChat();
    const panel = await screen.findByRole("complementary", { name: "Side chat" });
    const picker = panel.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(picker, {
      target: { files: [new File(["- Campbell"], "reading.md", { type: "text/markdown" })] },
    });
    const message = screen.getByLabelText("Message");
    const long = "word ".repeat(1000);
    fireEvent.paste(message, {
      clipboardData: { files: [], getData: () => long },
    });

    const chips = await screen.findByRole("list", { name: "Files to send" });
    await waitFor(() => expect(within(chips).queryByText("Reading…")).toBeNull());
    expect(within(chips).getByText("reading.md")).toBeTruthy();
    expect(within(chips).getByText("Pasted text.txt")).toBeTruthy();

    fireEvent.change(message, { target: { value: "Use these" } });
    fireEvent.keyDown(message, { key: "Enter" });
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "ai.send",
        expect.objectContaining({
          text: "Use these",
          attachments: [
            expect.objectContaining({ name: "reading.md", text: null }),
            expect.objectContaining({ name: "Pasted text.txt" }),
          ],
        }),
      ),
    );
    expect(screen.queryByRole("list", { name: "Files to send" })).toBeNull();
  });

  it("names a note with @ and sends it along with the message", async () => {
    const { invoke } = renderShell();
    await openChat();
    const message = await screen.findByLabelText("Message");
    fireEvent.change(message, { target: { value: "Compare @rea", selectionStart: 12 } });
    const options = await screen.findByRole("listbox", { name: "Notes" });
    expect(
      within(options)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Reading list"]);
    fireEvent.keyDown(message, { key: "Enter" });
    expect((message as HTMLTextAreaElement).value).toBe("Compare @Reading list ");
    expect(screen.queryByRole("listbox", { name: "Notes" })).toBeNull();

    fireEvent.keyDown(message, { key: "Enter" });
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "ai.send",
        expect.objectContaining({
          text: "Compare @Reading list",
          context: expect.objectContaining({
            mentions: [{ noteId: "note-2", title: "Reading list" }],
          }),
        }),
      ),
    );
  });

  it("brings back the last message with ↑, and stops a running reply with Escape", async () => {
    const { invoke } = renderShell({ threads: [thread([user()], true)] });
    await openSavedChat();
    await screen.findByText("Tidy my review");
    const message = screen.getByLabelText("Message");
    fireEvent.keyDown(message, { key: "ArrowUp" });
    expect((message as HTMLTextAreaElement).value).toBe("Tidy my review");
    fireEvent.keyDown(message, { key: "Escape" });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("ai.stop", { threadId: "thread-1" }));
  });

  it("chooses how hard the model thinks beside the message", async () => {
    const { invoke } = renderShell();
    await openChat();
    const reasoning = await screen.findByRole("button", { name: "Reasoning: Default" });
    fireEvent.pointerDown(reasoning, { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Extra High" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("ai.configure", { effort: "xhigh" }));
    expect(await screen.findByRole("button", { name: "Reasoning: Extra High" })).toBeTruthy();
  });

  it("picks a model of another provider that is set up, from its rail or by searching", async () => {
    const { invoke } = renderShell({
      status: {
        ...STATUS,
        model: "claude-opus-5-5",
        providers: [
          { ...STATUS.providers[0]!, models: ["claude-opus-5-5", "claude-haiku-5-5"] },
          {
            id: "openai",
            label: "OpenAI API",
            kind: "api-key",
            ready: true,
            detail: "Key ending in 9b1c",
            models: ["gpt-5.1"],
            experimental: false,
          },
          {
            id: "codex-cli",
            label: "Codex (your sign-in)",
            kind: "cli",
            ready: false,
            detail: "Not installed",
            models: [],
            experimental: true,
          },
        ],
      },
    });
    await openChat();
    // Opening the chat puts the focus in the message a frame later; the picker opens after.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Message")));
    fireEvent.click(await screen.findByRole("button", { name: "Model: Opus 5.5" }));
    const providers = await screen.findByRole("tablist", { name: "Providers" });
    // Only providers that are set up can be picked.
    expect(
      within(providers)
        .getAllByRole("tab")
        .map((tab) => tab.getAttribute("aria-label")),
    ).toEqual(["Anthropic", "OpenAI API"]);
    const models = screen.getByRole("listbox", { name: "Models" });
    expect(
      within(models)
        .getByRole("option", { name: /Opus 5\.5/ })
        .getAttribute("aria-selected"),
    ).toBe("true");

    fireEvent.change(screen.getByRole("textbox", { name: "Search models" }), {
      target: { value: "gpt" },
    });
    fireEvent.click(within(models).getByRole("option", { name: /GPT-5\.1/ }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("ai.configure", { provider: "openai", model: "gpt-5.1" }),
    );
  });

  it("holds a message written during a reply, and sends it when the reply ends", async () => {
    const { invoke, emit } = renderShell({ threads: [thread([user()], true)] });
    await openSavedChat();
    await screen.findByText("Tidy my review");
    const message = screen.getByLabelText("Message");
    fireEvent.change(message, { target: { value: "Then add a summary" } });
    fireEvent.keyDown(message, { key: "Enter" });

    const waiting = await screen.findByRole("list", { name: "Waiting to send" });
    expect(within(waiting).getByText("Then add a summary")).toBeTruthy();
    expect(invoke).not.toHaveBeenCalledWith("ai.send", expect.anything());

    act(() =>
      emit("ai.event", {
        type: "thread",
        thread: {
          id: "thread-1",
          title: "Review help",
          updatedAt: 2,
          running: false,
          mode: "supervised",
          plan: false,
        },
      }),
    );
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "ai.send",
        expect.objectContaining({ threadId: "thread-1", text: "Then add a summary" }),
      ),
    );
    expect(screen.queryByRole("list", { name: "Waiting to send" })).toBeNull();
  });

  it("shows how full the model's context is with the chat", async () => {
    const { emit } = renderShell({ threads: [thread([user()])] });
    await openSavedChat();
    await screen.findByText("Tidy my review");
    act(() =>
      emit("ai.event", {
        type: "thread",
        thread: {
          id: "thread-1",
          title: "Review help",
          updatedAt: 2,
          running: false,
          mode: "supervised",
          plan: false,
          context: { tokens: 850_000, window: 1_000_000 },
        },
      }),
    );
    expect(
      await screen.findByRole("img", { name: "Context: 850k of 1M tokens (85%)" }),
    ).toBeTruthy();
  });

  it("writes dictated speech into the message", async () => {
    const stopTrack = vi.fn();
    vi.stubGlobal("navigator", {
      ...navigator,
      mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: stopTrack }] }) },
    });
    vi.stubGlobal(
      "MediaRecorder",
      class {
        static isTypeSupported = () => true;
        mimeType = "audio/webm";
        state = "inactive";
        ondataavailable: ((event: { data: Blob }) => void) | null = null;
        onstop: (() => void) | null = null;
        start() {
          this.state = "recording";
        }
        stop() {
          this.state = "inactive";
          this.ondataavailable?.({ data: new Blob(["speech"]) });
          this.onstop?.();
        }
      },
    );
    vi.stubGlobal(
      "AudioContext",
      class {
        createAnalyser = () => ({ fftSize: 0, frequencyBinCount: 10, getByteFrequencyData() {} });
        createMediaStreamSource = () => ({ connect() {} });
        close = async () => undefined;
      },
    );
    const { invoke } = renderShell({ status: { ...STATUS, canDictate: true } });
    await openChat();
    fireEvent.click(await screen.findByRole("button", { name: "Dictate" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop and write it down" }));

    await waitFor(() =>
      expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe("Plan the week"),
    );
    expect(invoke).toHaveBeenCalledWith("ai.transcribe", {
      audio: expect.any(Uint8Array),
      mimeType: "audio/webm",
    });
    expect(stopTrack).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("offers to try a failed reply again", async () => {
    const { invoke } = renderShell({
      threads: [
        thread([user(), { kind: "error", id: "x1", turnId: "t1", message: "Overloaded." }]),
      ],
    });
    await openSavedChat();
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "ai.send",
        expect.objectContaining({ text: "Tidy my review" }),
      ),
    );
  });

  it("answers an approval", async () => {
    const { invoke } = renderShell({
      threads: [
        thread(
          [
            user(),
            {
              kind: "approval",
              id: "ap1",
              turnId: "t1",
              tool: "update_note",
              access: "edit",
              label: "Edit Weekly review",
              preview: "- old line\n+ new line",
              noteId: "note-1",
              status: "pending",
            },
          ],
          true,
        ),
      ],
    });
    await openSavedChat();
    const approval = await screen.findByRole("region", { name: "Approval" });
    expect(within(approval).getByText("+ new line")).toBeTruthy();
    fireEvent.click(within(approval).getByRole("button", { name: "Accept for this chat" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("ai.respond", {
        threadId: "thread-1",
        approvalId: "ap1",
        decision: "accept-for-chat",
      }),
    );
  });

  it("undoes one change or every change from a reply", async () => {
    const action = (id: string, label: string): AiChatItem => ({
      kind: "action",
      id,
      turnId: "t1",
      tool: "update_note",
      access: "edit",
      label,
      noteId: "note-1",
      status: "done",
      error: null,
      undoable: true,
    });
    const { invoke } = renderShell({
      threads: [
        thread([user(), action("e1", "Edited Weekly review"), action("e2", "Edited Goals")]),
      ],
    });
    await openSavedChat();
    // A finished reply folds its steps away; opening them shows each change.
    fireEvent.click(await screen.findByRole("button", { name: /steps$/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Undo: Edited Goals" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("ai.undo", { threadId: "thread-1", actionIds: ["e2"] }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Undo all changes from this reply" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("ai.undo", {
        threadId: "thread-1",
        actionIds: ["e2", "e1"],
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Edited Weekly review" }));
    expect(openNote).toHaveBeenCalledWith("note-1");
  });

  it("implements a finished plan", async () => {
    const { invoke } = renderShell({
      threads: [
        {
          ...thread([
            user({ plan: true }),
            { kind: "assistant", id: "a1", turnId: "t1", text: "1. Merge notes", streaming: false },
          ]),
          plan: true,
        },
      ],
    });
    await openSavedChat();
    const implement = await screen.findByRole("button", { name: "Implement plan" });
    expect(screen.getByRole("button", { name: "Plan", pressed: true })).toBeTruthy();
    fireEvent.click(implement);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("ai.send", {
        threadId: "thread-1",
        text: "Implement the plan.",
        context: null,
        mode: "supervised",
        plan: false,
      }),
    );
    expect(screen.getByRole("button", { name: "Plan", pressed: false })).toBeTruthy();
  });
});
