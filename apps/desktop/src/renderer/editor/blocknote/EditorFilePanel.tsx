import { FilePanel, UploadTab, useBlockNoteEditor } from "@blocknote/react";

/**
 * The panel the formatting toolbar's "Replace" button opens, with only an
 * Upload tab: notes show the images saved with them, not ones linked from the web.
 */
export function EditorFilePanel({ blockId }: { blockId: string }) {
  const editor = useBlockNoteEditor();
  return (
    <FilePanel
      blockId={blockId}
      tabs={[
        {
          name: editor.dictionary.file_panel.upload.title,
          // FilePanel's loading spinner is only reachable from its default tabs.
          tabPanel: <UploadTab blockId={blockId} setLoading={() => {}} />,
        },
      ]}
    />
  );
}
