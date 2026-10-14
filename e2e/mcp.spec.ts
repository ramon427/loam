import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { BridgeMcpConnection } from "@loam/shared/bridge/loamBridge";
import type { NoteDocument, NoteGraph, NotesBootstrap } from "@loam/shared/notes/noteModel";

import { expect, test } from "./app";
import { appendToBody, noteBody, noteRow, openSettings } from "./notes";

const freePort = async () => {
  const listener = createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  return port;
};
const call = async <T>(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> => {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
  return (result.structuredContent as { data: T }).data;
};

test("AI access setup, live edits and revocation work with a real HTTP client", async ({
  loam,
}) => {
  const settings = await openSettings(loam.window, "AI access");
  await expect(settings.getByText("Off", { exact: true })).toBeVisible();
  await settings.getByText("Connection details", { exact: true }).click();
  await settings.getByRole("spinbutton", { name: "MCP port" }).fill(String(await freePort()));
  await settings.getByRole("button", { name: "Enable AI access" }).click();
  await expect(settings.getByText("Running on this computer")).toBeVisible();
  await settings.getByRole("button", { name: "Copy HTTP configuration" }).click();
  await expect(settings.getByRole("status")).toContainText("HTTP configuration copied.");
  const connection = await loam.window.evaluate(async () => {
    const result = await window.loam!.invoke("mcp.connection", {});
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  });
  const config = JSON.parse(connection.config).mcpServers["loam"] as {
    url: string;
    headers: Record<string, string>;
  };
  const client = new Client({ name: "loam-desktop-e2e", version: "1" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: { headers: config.headers },
      }),
    );
    expect((await client.listTools()).tools.length).toBeGreaterThan(60);
    await loam.window.keyboard.press("Escape");
    const created = await call<NoteDocument>(client, "loam_notes_new", {
      title: "AI note",
      markdown: "# A heading\n\nAI created this note.\n\n- [ ] Task",
    });
    await expect(noteRow(loam.window, "AI note")).toBeVisible();
    await call(client, "loam_workspace_open", { noteId: created.id });
    await expect(noteBody(loam.window)).toContainText("AI created this note.");
    await appendToBody(loam.window, " User pending edit.");
    const note = await call<NoteDocument>(client, "loam_notes_get", { noteId: created.id });
    expect(JSON.stringify(note.blocksByTab)).toContain("User pending edit.");
    await call(client, "loam_blocks_set", {
      noteId: note.id,
      tabId: note.activeTabId,
      baseUpdatedAt: note.updatedAt,
      blocks: [
        ...note.blocksByTab[note.activeTabId]!,
        {
          id: crypto.randomUUID(),
          type: "paragraph",
          content: [{ type: "text", text: "AI edited the open note.", styles: {} }],
          children: [],
        },
      ],
    });
    await expect(noteBody(loam.window)).toContainText("AI edited the open note.");
    await expect(noteBody(loam.window)).toContainText("User pending edit.");
    await call(client, "loam_workspace_set_theme", { theme: "dark" });
    await expect(loam.window.locator("html")).toHaveAttribute("data-theme", "dark");
    const access = await openSettings(loam.window, "AI access");
    await access.getByRole("button", { name: "Turn off AI access" }).click();
    await expect(access.getByText("Off", { exact: true })).toBeVisible();
    await expect(client.listTools()).rejects.toThrow();
  } finally {
    await client.close();
  }
});

test("stdio clients import, export, render diagrams and manage backups through the running app", async ({
  loam,
}) => {
  test.setTimeout(120_000);
  const port = await freePort();
  const connection = (await loam.window.evaluate(async (port) => {
    const enabled = await window.loam!.invoke("mcp.configure", { enabled: true, port });
    if (!enabled.ok || !enabled.data.running) throw new Error("MCP did not start");
    const result = await window.loam!.invoke("mcp.connection", {});
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  }, port)) as BridgeMcpConnection;
  const client = new Client({ name: "loam-stdio-e2e", version: "1" });
  try {
    const stdio = JSON.parse(connection.stdioConfig).mcpServers["loam"] as {
      command: string;
      args: string[];
      env: Record<string, string>;
    };
    await client.connect(new StdioClientTransport({ ...stdio, stderr: "pipe" }));
    const vault = join(loam.root, "vault");
    const destination = join(loam.root, "exports");
    await mkdir(join(vault, "Projects"), { recursive: true });
    await mkdir(destination);
    await writeFile(
      join(vault, "Projects", "Plan.md"),
      "# Plan\n\nImported through MCP.\n\n[[Related]]\n\n![Tiny](../tiny.png)",
    );
    await writeFile(join(vault, "Related.md"), "# Related\n\nLinked note.");
    await writeFile(
      join(vault, "tiny.png"),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
        "base64",
      ),
    );
    expect(
      await call(client, "loam_import_run", { source: "markdown", paths: [vault] }),
    ).toMatchObject({ noteCount: 2, folderCount: 1 });
    const library = await call<NotesBootstrap>(client, "loam_notes_library");
    const plan = library.notes.find((note) => note.title === "Plan")!;
    const related = library.notes.find((note) => note.title === "Related")!;
    expect(await call(client, "loam_notes_backlinks", { noteId: related.id })).toMatchObject({
      noteCount: 1,
    });
    let note = await call<NoteDocument>(client, "loam_notes_get", { noteId: plan.id });
    const imageUrl = JSON.stringify(note.blocksByTab).match(
      /loam-media:\/\/images\/[a-f0-9-]+\.png/,
    )![0];
    const image = await call<{ base64: string }>(client, "loam_media_read_image", {
      reference: imageUrl,
    });
    expect(Buffer.from(image.base64, "base64")[0]).toBe(0x89);
    const tab = await call<{ tabId: string }>(client, "loam_tabs_add", {
      noteId: plan.id,
      title: "Flow",
      kind: "graph",
      baseUpdatedAt: note.updatedAt,
    });
    note = await call<NoteDocument>(client, "loam_notes_get", { noteId: plan.id });
    await call(client, "loam_graphs_import", {
      noteId: plan.id,
      tabId: tab.tabId,
      baseUpdatedAt: note.updatedAt,
      format: "mermaid",
      text: "flowchart LR\n A[Start] --> B[Finish]",
    });
    expect(
      await call(client, "loam_graphs_export", {
        noteId: plan.id,
        tabId: tab.tabId,
        format: "svg",
      }),
    ).toMatchObject({ text: expect.stringContaining("<svg") });
    const png = await call<{ base64: string }>(client, "loam_graphs_export", {
      noteId: plan.id,
      tabId: tab.tabId,
      format: "png",
    });
    expect(Buffer.from(png.base64, "base64").subarray(1, 4).toString()).toBe("PNG");
    const templates = await call<Array<{ id: string }>>(client, "loam_graphs_templates");
    expect(templates.length).toBeGreaterThan(0);
    const template = await call<NoteGraph>(client, "loam_graphs_templates", {
      templateId: templates[0]!.id,
    });
    note = await call<NoteDocument>(client, "loam_notes_get", { noteId: plan.id });
    await call(client, "loam_graphs_set", {
      noteId: plan.id,
      tabId: tab.tabId,
      graph: template,
      baseUpdatedAt: note.updatedAt,
    });
    note = await call<NoteDocument>(client, "loam_notes_get", { noteId: plan.id });
    await call(client, "loam_graphs_layout", {
      noteId: plan.id,
      tabId: tab.tabId,
      mode: "grid",
      baseUpdatedAt: note.updatedAt,
    });
    note = await call<NoteDocument>(client, "loam_notes_get", { noteId: plan.id });
    await call(client, "loam_video_set", {
      noteId: plan.id,
      video: { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", videoId: "dQw4w9WgXcQ" },
      baseUpdatedAt: note.updatedAt,
    });
    await call(client, "loam_workspace_open", { noteId: plan.id, tabId: note.tabs[0]!.id });
    await expect(loam.window.getByRole("main").locator("[data-note-title-field]")).toBeVisible();
    expect(await call(client, "loam_workspace_video", { command: "open" })).toMatchObject({
      requested: "open",
    });
    await expect(
      loam.window.locator('iframe[src^="https://www.youtube.com/embed/"]'),
    ).toBeVisible();
    expect(await call(client, "loam_workspace_video", { command: "pause" })).toMatchObject({
      requested: "pause",
    });
    const backup = await call<{ id: string }>(client, "loam_backups_create");
    expect(await call(client, "loam_backups_list")).toMatchObject({
      backups: expect.arrayContaining([expect.objectContaining({ id: backup.id })]),
    });
    const exported = await call<{ status: string; directory: string; noteCount: number }>(
      client,
      "loam_export_markdown",
      { scope: { kind: "all" }, parentDirectory: destination },
    );
    expect(exported).toMatchObject({ status: "done", noteCount: 2 });
    expect(await readFile(join(exported.directory, "Projects", "Plan.md"), "utf8")).toContain(
      "[[Related]]",
    );
    await expect(noteRow(loam.window, "Related")).toBeVisible();
    await call(client, "loam_notes_new", { title: "After the backup" });
    await loam.expectSelfRestart(async () => {
      await call(client, "loam_backups_restore", { backupId: backup.id });
    });
    const restored = await call<NotesBootstrap>(client, "loam_notes_library");
    expect(restored.notes).toHaveLength(2);
    expect(restored.notes.some((entry) => entry.title === "After the backup")).toBe(false);
  } finally {
    await client.close();
  }
});

test("encrypted notes stay locked to MCP until the user unlocks the app", async ({ loam }) => {
  test.setTimeout(120_000);
  const port = await freePort();
  const config = await loam.window.evaluate(async (port) => {
    await window.loam!.invoke("mcp.configure", { enabled: true, port });
    const result = await window.loam!.invoke("mcp.connection", {});
    if (!result.ok) throw new Error("MCP connection unavailable");
    return JSON.parse(result.data.config).mcpServers["loam"] as {
      url: string;
      headers: Record<string, string>;
    };
  }, port);
  const client = new Client({ name: "loam-encryption-e2e", version: "1" });
  const passphrase = "test-only strong passphrase";
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: { headers: config.headers },
      }),
    );
    const note = await call<NoteDocument>(client, "loam_notes_new", { title: "Encrypted AI note" });
    const { recoveryKey } = await call<{ recoveryKey: string }>(
      client,
      "loam_security_new_recovery_key",
    );
    await call(client, "loam_security_enable", { passphrase, recoveryKey });
    expect(await call(client, "loam_security_status")).toEqual({ state: "on" });
    await loam.restart();
    expect(await call(client, "loam_security_status")).toEqual({ state: "locked" });
    const locked = await client.callTool({
      name: "loam_notes_get",
      arguments: { noteId: note.id },
    });
    expect(locked.isError).toBe(true);
    expect(locked.structuredContent).toMatchObject({ error: { code: "LOCKED" } });
    // Only the user unlocks the notes.
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).not.toContain("loam_security_unlock");
    expect(names).not.toContain("loam_security_reset_passphrase");
    await loam.window.getByLabel("Passphrase").fill(passphrase);
    await loam.window.getByRole("button", { name: "Unlock", exact: true }).click();
    await expect(noteRow(loam.window, "Encrypted AI note")).toBeVisible();
    expect(await call(client, "loam_notes_get", { noteId: note.id })).toMatchObject({
      title: "Encrypted AI note",
    });
    await call(client, "loam_security_disable", { passphrase });
  } finally {
    await client.close();
  }
});
