import { useCallback, useMemo } from "react";
import { SuggestionMenu } from "@blocknote/core/extensions";

import { getDefaultEditorSlashMenuItems } from "./defaultSlashMenuItems";
import { mountedEditorDom, type NoteBlockEditor } from "./noteEditorSchema";
import {
  buildSlashMenuItems,
  isSlashMenuCloseGuardActive,
  isSlashQueryAbandoned,
  isValidSlashTrigger,
  loadRecentSlashMenuIds,
  trackRecentSlashMenuItem,
  type SlashCommand,
  type SlashMenuItem,
} from "./slashMenuModel";

/**
 * The slash menu's items: BlockNote's blocks (its "Image" item replaced by
 * `onInsertImage`) plus `extraItems`, filtered and ranked for the typed query.
 */
export function useEditorSlashMenu({
  editor,
  extraItems,
  onInsertImage,
}: {
  editor: NoteBlockEditor;
  /** Host-specific commands offered beside the default blocks; keep the array stable. */
  extraItems: readonly SlashCommand[];
  onInsertImage: () => void;
}) {
  const items = useMemo(
    () => [
      ...getDefaultEditorSlashMenuItems(editor).map((item) =>
        item.key === "image" ? { ...item, onItemClick: onInsertImage } : item,
      ),
      ...extraItems,
    ],
    [editor, extraItems, onInsertImage],
  );

  const getSlashItems = useCallback(
    async (query: string): Promise<SlashMenuItem[]> => {
      if (!mountedEditorDom(editor)?.isConnected) return [];
      if (
        isSlashMenuCloseGuardActive() ||
        isSlashQueryAbandoned(query) ||
        !isValidSlashTrigger(editor.prosemirrorState)
      ) {
        editor.getExtension(SuggestionMenu)?.closeMenu();
        return [];
      }
      return buildSlashMenuItems({
        items,
        query,
        contextBlockType: editor.getTextCursorPosition().block.type,
        recentIds: loadRecentSlashMenuIds(),
      });
    },
    [editor, items],
  );

  const handleSlashItemClick = useCallback((item: SlashMenuItem) => {
    trackRecentSlashMenuItem(item.key);
    item.onItemClick();
  }, []);

  return { getSlashItems, handleSlashItemClick };
}
