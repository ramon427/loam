import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type {
  LoamBridgeMethod,
  LoamBridgeParams,
  LoamBridgeResult,
} from "@loam/shared/bridge/loamBridge";
import { tabKindOf, TAB_CONTENT_KEYS, type NoteTabKind } from "@loam/shared/notes/noteModel";
import { StoreError } from "@loam/storage/storeError";

import type { Dispatch } from "../requests/dispatch";
import type { AppServices } from "../requests/handlers";
import { BRIDGE_PARAMS, uuidSchema } from "../requests/params";
import { BRIDGE_TOOLS, toolName, type BridgeTool, type ToolFlags } from "./bridgeTools";
import { graphTools } from "./graphTools";
import { layoutTools } from "./layoutTools";
import { noteTools } from "./noteTools";
import { pathTools } from "./pathTools";
import { tabTools } from "./tabTools";
import { workspaceTools } from "./workspaceTools";

/** One MCP tool: its published input schema and what it does. */
export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  annotations: ToolAnnotations;
  /** Whether the result is an image (`{ base64, mimeType }`) the client should also show. */
  returnsImage?: (input: Record<string, unknown>) => boolean;
  run: (input: Record<string, unknown>) => Promise<unknown>;
};

const annotations = (flags: ToolFlags): ToolAnnotations => ({
  readOnlyHint: Boolean(flags.readOnly),
  destructiveHint: Boolean(flags.destructive),
  idempotentHint: Boolean(flags.readOnly),
  openWorldHint: false,
});

/** What every group of tools is made with: requests as AI clients make them, and shared shapes. */
const createToolContext = ({ dispatch, app }: { dispatch: Dispatch; app: AppServices }) => {
  const call = async <M extends LoamBridgeMethod>(
    method: M,
    params: LoamBridgeParams<M>,
  ): Promise<LoamBridgeResult<M>> => {
    const result = await dispatch(method, params, "ai");
    if (!result.ok)
      throw new StoreError(result.error.message, result.error.code, result.error.status);
    return result.data;
  };

  /** Defines tools that make `method`, or that are made only for AI clients (`null`). */
  const defineFor =
    (method: LoamBridgeMethod | null) =>
    <S extends z.ZodRawShape>(
      name: string,
      description: string,
      shape: S,
      run: (input: z.output<z.ZodObject<S>>) => Promise<unknown>,
      flags: ToolFlags = {},
      returnsImage?: ToolDefinition["returnsImage"],
    ): ToolDefinition => {
      const inputSchema = z.strictObject(shape);
      return {
        name,
        description,
        inputSchema,
        annotations: annotations(flags),
        returnsImage,
        run: async (input) => {
          // Before anything else, so a locked library doesn't even save the window's edits.
          app.gate.checkAccess(method, "ai");
          const parsed = inputSchema.parse(input);
          if (flags.flushFirst) await app.workspace.flush();
          return run(parsed);
        },
      };
    };

  const fullNote = (noteId: string) => call("notes.get", { noteId });

  /** Replaces one tab's content, keeping the rest of the note as the client read it. */
  const patchTab = async (
    noteId: string,
    tabId: string,
    baseUpdatedAt: string,
    kind: keyof typeof TAB_CONTENT_KEYS,
    value: unknown,
  ) => {
    const note = await fullNote(noteId);
    // A board holds a table as a table tab does.
    const sameContent = (other: NoteTabKind) =>
      TAB_CONTENT_KEYS[other as keyof typeof TAB_CONTENT_KEYS] === TAB_CONTENT_KEYS[kind];
    if (!note.tabs.some((tab) => tab.id === tabId && sameContent(tabKindOf(tab))))
      throw new StoreError(
        "That tab has a different type or does not exist.",
        "VALIDATION_ERROR",
        400,
      );
    const key = TAB_CONTENT_KEYS[kind];
    return call("notes.save", {
      noteId,
      patch: { [key]: { ...note[key], [tabId]: value } },
      baseUpdatedAt,
    });
  };

  return {
    app,
    call,
    defineFor,
    define: defineFor(null),
    fullNote,
    patchTab,
    noteId: { noteId: uuidSchema },
    baseUpdatedAt: z
      .string()
      .min(1)
      .describe(
        "The updatedAt from the last note read. A stale version is rejected; read again before retrying.",
      ),
    /** For tools that read or write notes: the window's pending edits are saved first. */
    withNotes: { flushFirst: true } as const,
  };
};

export type ToolContext = ReturnType<typeof createToolContext>;

/** One tool per bridge request that has one (see BRIDGE_TOOLS). */
const bridgeTools = ({ call, defineFor }: ToolContext) =>
  (Object.keys(BRIDGE_TOOLS) as LoamBridgeMethod[]).flatMap((method) => {
    const tool = BRIDGE_TOOLS[method] as BridgeTool<LoamBridgeMethod>;
    if (!tool) return [];
    const schema = tool.input?.schema ?? BRIDGE_PARAMS[method];
    if (!(schema instanceof z.ZodObject))
      throw new Error(`The ${method} tool needs an input schema an AI client can read.`);
    return [
      defineFor(method)(
        toolName(method),
        tool.description,
        schema.shape,
        (input) =>
          call(method, (tool.input ? tool.input.toParams(input as never) : input) as never),
        tool,
      ),
    ];
  });

/**
 * The tools AI clients get: one per bridge request that has one, plus tools
 * shaped for AI work (paths instead of dialogs, convenience edits that keep
 * the rest of a note, and requests only the window can carry out).
 */
export const createMcpTools = (services: {
  dispatch: Dispatch;
  app: AppServices;
}): ToolDefinition[] => {
  const context = createToolContext(services);
  return [
    ...bridgeTools(context),
    ...pathTools(context),
    ...noteTools(context),
    ...layoutTools(context),
    ...tabTools(context),
    ...graphTools(context),
    ...workspaceTools(context),
  ];
};
