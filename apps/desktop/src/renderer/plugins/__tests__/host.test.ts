// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BridgePluginInfo } from "@loam/shared/plugins/pluginApi";
import { pluginManifestSchema } from "@loam/shared/plugins/pluginManifest";

const toasts = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
}));
vi.mock("../../ui/toast", () => toasts);

import { installFakeBridge } from "../../testing/fakeBridge";
import { createPluginHost, type PluginHost } from "../host";
import type { WorkerPort } from "../pluginInstance";
import type { HostMessage, WorkerMessage } from "../protocol";
import { createRuntime, type Register } from "../runtime";

/** The plugin API as the tests call it. */
type Api = Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>;
type OpenEvent = { noteId: string; seenBy: string[] };

/** Each test plugin's register function, by id; the fake worker "loads" it instead of code. */
const plugins = new Map<string, Register>();

/** A worker in this process: the real runtime, with messages delivered a tick later. */
const spawn = (pluginId: string): WorkerPort => {
  let toHost: ((message: WorkerMessage) => void) | undefined;
  let toRuntime: ((message: HostMessage) => void) | undefined;
  let terminated = false;
  const runtime = createRuntime({
    post: (message) => queueMicrotask(() => !terminated && toHost?.(message)),
    listen: (handler) => {
      toRuntime = handler;
    },
  });
  return {
    post: (message) =>
      queueMicrotask(() => {
        if (terminated) return;
        if (message.t === "load") void runtime.start(plugins.get(pluginId));
        else toRuntime?.(message);
      }),
    listen: (handler) => {
      toHost = handler;
    },
    terminate: () => {
      terminated = true;
    },
  };
};

const info = (id: string, permissions: string[] = []): BridgePluginInfo => ({
  folder: id,
  enabled: true,
  granted: permissions,
  settings: {},
  ok: true,
  manifest: pluginManifestSchema.parse({
    id,
    name: id,
    version: "1.0.0",
    apiVersion: 1,
    permissions,
  }),
});

let host: PluginHost;
let stop: () => void;
let calls: ReturnType<typeof installFakeBridge>["invoke"];

const start = async (...list: BridgePluginInfo[]) => {
  calls = installFakeBridge({
    "plugins.list": () => ({ restrictedMode: false, plugins: list }),
    "plugins.source": () => ({ code: "" }),
    "plugins.call": ({ op, params }: { op: string; params: unknown }) => ({ op, params }),
  }).invoke;
  host = createPluginHost({ spawn });
  stop = host.start();
  await vi.waitFor(() =>
    expect(Object.values(host.snapshot().status)).toEqual(list.map(() => "running")),
  );
};

beforeEach(() => {
  plugins.clear();
  vi.clearAllMocks();
});

afterEach(() => stop?.());

describe("plugin host", () => {
  it("runs a command a plugin registered", async () => {
    const ran = vi.fn();
    plugins.set("daily", async (on) => {
      on("app.ready", async ($: Api) => {
        await $.commands.register({ id: "today", title: "Open today's note", key: "Mod+Shift+D" });
      });
      on("command.run", { command: "today" }, async () => ran());
    });
    await start(info("daily"));

    await vi.waitFor(() =>
      expect(host.snapshot().commands).toEqual([
        {
          pluginId: "daily",
          id: "plugin:daily.today",
          title: "Open today's note",
          key: "Mod+Shift+D",
        },
      ]),
    );
    await host.runCommand("plugin:daily.today");
    expect(ran).toHaveBeenCalledTimes(1);
  });

  it("passes an event along the chain, each hook seeing what the one before handed on", async () => {
    plugins.set("a-first", async (on) => {
      on("note.open", async (_$, e: OpenEvent, next) => next({ ...e, seenBy: ["a-first"] }));
    });
    plugins.set("b-second", async (on) => {
      on("note.open", async (_$, e: OpenEvent, next) => {
        if (e.noteId === "secret") return { deny: "That note is private." };
        return next({ ...e, seenBy: [...e.seenBy, "b-second"] });
      });
    });
    await start(info("a-first"), info("b-second"));
    const base = vi.fn((e: unknown) => ({ opened: e }));

    expect(await host.dispatch("note.open", { noteId: "n1" }, base)).toEqual({
      opened: { noteId: "n1", seenBy: ["a-first", "b-second"] },
    });
    expect(await host.dispatch("note.open", { noteId: "secret" }, base)).toEqual({
      deny: "That note is private.",
    });
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("skips a hook that throws, logging why, and goes on with the rest", async () => {
    plugins.set("broken", async (on) => {
      on("note.open", async () => {
        throw new Error("oops");
      });
    });
    await start(info("broken"));

    expect(await host.dispatch("note.open", { noteId: "n1" }, () => "base")).toBe("base");
    expect(host.snapshot().logs.broken?.at(-1)).toMatchObject({
      level: "error",
      text: "note.open hook: oops",
    });
  });

  it("refuses what the plugin was not granted", async () => {
    const outcome = vi.fn();
    plugins.set("quiet", async (on) => {
      on("app.ready", async ($: Api) => {
        await $.ui.toast("hello").then(
          () => outcome("shown"),
          (error: Error) => outcome(error.message),
        );
      });
    });
    await start(info("quiet"));

    await vi.waitFor(() =>
      expect(outcome).toHaveBeenCalledWith("The plugin was not granted the ui permission."),
    );
    expect(toasts.toastInfo).not.toHaveBeenCalled();
  });

  it("shows a toast for a plugin granted ui", async () => {
    plugins.set("loud", async (on) => {
      on("app.ready", async ($: Api) => $.ui.toast("Saved", { tone: "success" }));
    });
    await start(info("loud", ["ui"]));
    await vi.waitFor(() =>
      expect(toasts.toastSuccess).toHaveBeenCalledWith("Saved", { description: "loud" }),
    );
  });

  it("parses Markdown before creating a note through the main process", async () => {
    plugins.set("writer", async (on) => {
      on("command.run", async ($: Api) => $.notes.create({ title: "Hi", markdown: "# Hello" }));
    });
    await start(info("writer", ["notes:write"]));
    vi.doMock("../../editor/blockParsers", () => ({
      parseMarkdown: (text: string) => [{ type: "heading", text }],
    }));
    await host.dispatch("command.run", { command: "x" }, () => null);

    expect(calls).toHaveBeenCalledWith("plugins.call", {
      id: "writer",
      op: "notes.create",
      params: { title: "Hi", blocks: [{ type: "heading", text: "# Hello" }] },
    });
  });

  it("draws each plugin's part of a slot and sends presses back to its handler", async () => {
    plugins.set("counter", async (on) => {
      on("ui.render", { slot: "note.header" }, async ($: Api) => {
        const count = ((await $.state.get("count")) as number | null) ?? 0;
        return {
          type: "Button",
          props: { onPress: () => $.state.set("count", count + 1) },
          children: [`Clicked ${count}`],
        };
      });
    });
    await start(info("counter"));

    expect(host.snapshot().renderers).toEqual(["counter"]);
    const tree = await host.renderPart("note.header", "r1", { noteId: "n1" }, "counter");
    expect(tree).toMatchObject({ type: "Button", children: ["Clicked 0"] });
    const handler = (tree as { props: { onPress: { __handler: string } } }).props.onPress;
    host.press("counter", handler.__handler, undefined);

    await vi.waitFor(() => expect(host.snapshot().drawVersions.counter).toBe(1));
    expect(await host.renderPart("note.header", "r1", { noteId: "n1" }, "counter")).toMatchObject({
      children: ["Clicked 1"],
    });
  });

  it("draws again only the parts of the plugin whose state changed", async () => {
    plugins.set("ticker", async (on) => {
      on("command.run", async ($: Api) => $.state.set("tick", Date.now()));
      on("ui.render", async () => null);
    });
    plugins.set("still", async (on) => {
      on("ui.render", async () => null);
    });
    await start(info("still"), info("ticker"));

    await host.dispatch("command.run", { command: "tick" }, () => null);
    expect(host.snapshot().drawVersions).toEqual({ ticker: 1 });
  });

  it("forgets everything a plugin added when it stops", async () => {
    plugins.set("daily", async (on) => {
      on("app.ready", async ($: Api) => $.commands.register({ id: "today", title: "Today" }));
    });
    await start(info("daily"));
    await vi.waitFor(() => expect(host.snapshot().commands).toHaveLength(1));

    stop();
    expect(host.snapshot().commands).toEqual([]);
    expect(host.hooks("app.ready")).toBe(false);
  });

  it("keeps an unchanged plugin running, with its state, when another is switched on", async () => {
    plugins.set("keeper", async (on) => {
      on("app.ready", async ($: Api) =>
        $.state.set("started", (await $.state.get("started")) ?? 0),
      );
      on("command.run", async ($: Api) => $.state.set("count", 7));
      on("ui.render", async ($: Api) => ({
        type: "Text",
        props: {},
        children: [String(await $.state.get("count"))],
      }));
    });
    plugins.set("newcomer", async () => undefined);
    await start(info("keeper"));
    await host.dispatch("command.run", { command: "x" }, () => null);

    installFakeBridge({
      "plugins.list": () => ({
        restrictedMode: false,
        plugins: [info("keeper"), info("newcomer")],
      }),
      "plugins.source": () => ({ code: "" }),
    });
    await host.reload();
    await vi.waitFor(() => expect(host.snapshot().status.newcomer).toBe("running"));
    expect(await host.renderPart("x", "r", {}, "keeper")).toMatchObject({ children: ["7"] });

    await host.reload({ restart: true });
    await vi.waitFor(() => expect(host.snapshot().status.keeper).toBe("running"));
    expect(await host.renderPart("x", "r", {}, "keeper")).toMatchObject({ children: ["null"] });
  });

  it("reports a plugin whose module has no register function", async () => {
    await start();
    plugins.set("empty", undefined as unknown as Register);
    installFakeBridge({
      "plugins.list": () => ({ restrictedMode: false, plugins: [info("empty")] }),
      "plugins.source": () => ({ code: "" }),
    });
    await host.reload();
    await vi.waitFor(() => expect(host.snapshot().status.empty).toBe("failed"));
    expect(host.snapshot().logs.empty?.at(-1)?.text).toContain("must export a register function");
  });
});
