import type { NoteGraphImportFormat } from "./noteGraphImport";

/**
 * What the canvas is doing right now. Only one mode is active at a time, and the keyboard
 * map enables keys per mode, so for example canvas keys never act while a snapshot area is
 * being selected.
 */
export type NoteGraphMode =
  | { kind: "idle" }
  /** Keyboard connecting: arrow keys pick a target near `sourceId`, Enter connects. */
  | { kind: "connect"; sourceId: string; candidateIndex: number }
  | { kind: "walkthrough"; order: readonly string[]; index: number }
  | { kind: "captureSnapshot" }
  /** Touch: a long press on empty canvas switches dragging to rectangle selection. */
  | { kind: "touchMarquee" }
  /** A node's title or text is being edited on the canvas. `requestId` restarts the draft. */
  | { kind: "editTitle"; nodeId: string; requestId: number }
  | { kind: "editEdgeLabel"; edgeId: string; draft: string }
  | { kind: "import"; format: NoteGraphImportFormat }
  | { kind: "headingManager"; nodeId: string };

export const idleMode: NoteGraphMode = { kind: "idle" };
