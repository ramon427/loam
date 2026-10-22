import type { BridgeAutomationCommand, BridgeResult } from "@loam/shared/bridge/loamBridge";
import { callBridge, onBridgeEvent } from "./bridge";
import { chooseThemeChoice, readThemeChoice, resolveTheme } from "@loam/notes-ui/lib/theme";
import { findTheme, readAppearance, updateAppearance } from "./themes/appearance";
import { emitAppEvent } from "@loam/notes-ui/lib/appEventBus";
import { convertImport } from "./import-export/convertImport";
import { saveAllNoteEditsOrThrow } from "@loam/notes-ui/workspace/saveAllNoteEdits";
import { buildYouTubePlayerCommandMessage } from "@loam/shared/notes/noteVideo";
import { errorMessage } from "@loam/notes-ui/lib/errorMessage";

/** Runs named app operations, using the same editor parsers and converters as the UI. */
const runAutomationCommand = async (command: BridgeAutomationCommand): Promise<unknown> => {
  switch (command.action) {
    case "graphTemplates": {
      const { noteGraphTemplates } = await import("@loam/notes-ui/graph/noteGraphTemplates");
      if (!command.templateId)
        return noteGraphTemplates.map(({ id, label, description }) => ({ id, label, description }));
      const template = noteGraphTemplates.find((entry) => entry.id === command.templateId);
      if (!template) throw new Error("Diagram template not found.");
      return { enabled: true, ...template.build() };
    }
    case "layoutGraph": {
      const [
        { computeNoteGraphGridLayout, computeNoteGraphTidyLayout },
        { applyLayout, emptyNoteGraphSelection },
      ] = await Promise.all([
        import("@loam/notes-ui/graph/noteGraphLayout"),
        import("@loam/notes-ui/graph/noteGraphOps"),
      ]);
      const { graph, mode } = command;
      const positions =
        mode === "grid"
          ? computeNoteGraphGridLayout(graph.nodes)
          : computeNoteGraphTidyLayout(graph);
      const edit = applyLayout({ graph, selection: emptyNoteGraphSelection }, positions, mode);
      return edit.graph ?? graph;
    }
    case "video": {
      if (command.command === "open") {
        let videoId: string | null = null;
        emitAppEvent("notes:open-video", {
          respond: (id) => {
            videoId = id;
          },
        });
        if (!videoId) throw new Error("Open a note with an attached video first.");
        return { requested: "open", videoId };
      }
      const frame = document.querySelector<HTMLIFrameElement>(
        'iframe[src^="https://www.youtube.com/embed/"]',
      );
      if (!frame?.contentWindow) throw new Error("Open a note's video panel first.");
      if (command.command === "seek" && command.seconds === undefined)
        throw new Error("Seek requires a timestamp in seconds.");
      const func =
        command.command === "seek"
          ? "seekTo"
          : command.command === "play"
            ? "playVideo"
            : "pauseVideo";
      frame.contentWindow.postMessage(
        buildYouTubePlayerCommandMessage(
          func,
          command.command === "seek" ? [command.seconds, true] : [],
        ),
        "https://www.youtube.com",
      );
      return { requested: command.command, seconds: command.seconds ?? null };
    }
    case "status": {
      let open: { noteId: string | null; tabId: string | null } = { noteId: null, tabId: null };
      emitAppEvent("notes:read-open", { respond: (current) => (open = current) });
      return { ...open, theme: resolveTheme() };
    }
    case "flush":
      await saveAllNoteEditsOrThrow();
      return null;
    case "openNote":
      await saveAllNoteEditsOrThrow();
      emitAppEvent("notes:open", { noteId: command.noteId, tabId: command.tabId });
      return { noteId: command.noteId, tabId: command.tabId ?? null };
    case "setTheme": {
      // The title bar passes the change on to the native window.
      if (command.themeId !== undefined) {
        if (!findTheme(command.themeId)) throw new Error(`No theme has the id ${command.themeId}.`);
        updateAppearance({ themeId: command.themeId });
      }
      if (command.theme) chooseThemeChoice(command.theme);
      return { theme: readThemeChoice(), themeId: readAppearance().themeId };
    }
    case "parseMarkdown": {
      const { parseMarkdown } = await import("@loam/notes-ui/editor/blockParsers");
      return parseMarkdown(command.text);
    }
    case "parseHtml": {
      const { parseHtml } = await import("@loam/notes-ui/editor/blockParsers");
      return parseHtml(command.text);
    }
    case "convertImport":
      return convertImport(command);
    case "exportGraph": {
      if (command.format === "svg") {
        const { buildNoteGraphSvg } = await import("@loam/notes-ui/graph/noteGraphSvg");
        return { text: buildNoteGraphSvg(command.graph), mimeType: "image/svg+xml" };
      }
      const { renderNoteGraphImage } = await import("@loam/notes-ui/graph/noteGraphImage");
      const canvas = await renderNoteGraphImage(command.graph);
      return { base64: canvas.toDataURL("image/png").split(",")[1], mimeType: "image/png" };
    }
  }
};

export const installAutomation = () =>
  onBridgeEvent("app.automation", ({ requestId, command }) => {
    void (async () => {
      let result: BridgeResult<unknown>;
      try {
        result = { ok: true, data: await runAutomationCommand(command) };
      } catch (error) {
        result = {
          ok: false,
          error: {
            code: "AUTOMATION_FAILED",
            message: errorMessage(error, "The workspace operation failed."),
            status: 500,
          },
        };
      }
      await callBridge("app.automationResult", { requestId, result });
    })().catch(() => undefined);
  });
