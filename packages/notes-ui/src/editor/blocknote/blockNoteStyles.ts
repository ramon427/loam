/**
 * The single import boundary for BlockNote styling.
 *
 * Keep this order stable: vendor defaults, portaled UI overrides, then the
 * App-owned CSS module. Consumers must import `editorStyles` from here
 * instead of importing either stylesheet directly.
 */
import "@blocknote/shadcn/style.css";
import "./blockNotePortals.css";
import editorStyles from "./editorStyles.module.css";

const blockNoteEditorRootClassName = "loam-editor-root";

export { blockNoteEditorRootClassName, editorStyles };
