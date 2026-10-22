import { SuggestionMenuController } from "@blocknote/react";

import { BlockNoteSlashMenu } from "./BlockNoteSlashMenu";
import { slashMenuFloatingOptions } from "./slashMenuFloatingOptions";
import type { SlashMenuItem } from "../slashMenuModel";

type SlashMenuControllerProps = {
  enabled: boolean;
  getItems: (query: string) => Promise<SlashMenuItem[]>;
  onItemClick: (item: SlashMenuItem) => void;
};

export const SlashMenuController = ({
  enabled,
  getItems,
  onItemClick,
}: SlashMenuControllerProps) => {
  if (!enabled) return null;

  return (
    <SuggestionMenuController
      triggerCharacter="/"
      getItems={getItems}
      suggestionMenuComponent={BlockNoteSlashMenu}
      onItemClick={onItemClick}
      floatingUIOptions={slashMenuFloatingOptions}
    />
  );
};
