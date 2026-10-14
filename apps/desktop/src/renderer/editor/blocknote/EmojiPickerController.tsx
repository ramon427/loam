import { useCallback, useContext, type HTMLAttributes } from "react";
import { GridSuggestionMenuController, useBlockNoteEditor } from "@blocknote/react";
import { EmojiGrid } from "./EmojiGrid";
import { getEmojiItems } from "./emojiItems";
import { EditorPortalContext } from "./EditorPortal";
import { slashMenuFloatingOptions } from "./slashMenuFloatingOptions";

const floatingOptions = {
  ...slashMenuFloatingOptions,
  elementProps: { style: { zIndex: 10080 } } as HTMLAttributes<HTMLDivElement>,
};

export function EmojiPickerController() {
  const editor = useBlockNoteEditor();
  const getItems = useCallback((query: string) => getEmojiItems(editor, query), [editor]);
  const portalElement = useContext(EditorPortalContext);
  return (
    <GridSuggestionMenuController
      getItems={getItems}
      gridSuggestionMenuComponent={EmojiGrid}
      triggerCharacter=":"
      columns={10}
      minQueryLength={2}
      portalElement={portalElement}
      floatingUIOptions={floatingOptions}
    />
  );
}
