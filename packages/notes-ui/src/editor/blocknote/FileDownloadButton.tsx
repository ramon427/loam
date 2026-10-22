import { blockHasType } from "@blocknote/core";
import {
  useBlockNoteEditor,
  useComponentsContext,
  useDictionary,
  useEditorState,
} from "@blocknote/react";
import { DownloadIcon } from "lucide-react";
import { useState } from "react";

import { saveImageAs } from "../../media/imageCopies";
import { toMediaPath } from "../../media/mediaSrc";

/** Saves a copy of the selected block's image wherever the user picks. */
export function FileDownloadButton() {
  const editor = useBlockNoteEditor();
  const components = useComponentsContext();
  const dictionary = useDictionary();
  const [saving, setSaving] = useState(false);
  const block = useEditorState({
    editor,
    selector: ({ editor }) => {
      const selected = editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block];
      if (selected.length !== 1) return undefined;
      const candidate = selected[0];
      return blockHasType(candidate, editor, candidate.type, { url: "string" })
        ? candidate
        : undefined;
    },
  });
  // Only images saved in the notes can be copied out; a web image has no file here.
  const path = block ? toMediaPath(block.props.url) : null;
  if (!block || !path || !components) return null;

  const label =
    dictionary.formatting_toolbar.file_download.tooltip[block.type] ??
    dictionary.formatting_toolbar.file_download.tooltip.file;
  const save = async () => {
    setSaving(true);
    try {
      await saveImageAs(path);
    } finally {
      setSaving(false);
    }
  };
  return (
    <components.FormattingToolbar.Button
      className="bn-button"
      label={label}
      mainTooltip={label}
      icon={<DownloadIcon aria-hidden="true" />}
      isDisabled={saving}
      onClick={() => void save()}
    />
  );
}
