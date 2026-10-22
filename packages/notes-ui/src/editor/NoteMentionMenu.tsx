import { SuggestionMenuController, type SuggestionMenuProps } from "@blocknote/react";

import { cn } from "../ui/cn";
import { dropdownItemClass, dropdownLabelClass } from "../styles/dropdowns";
import type { NoteMentionMenuItem } from "./noteMentions";
import { editorStyles as styles } from "./blocknote/blockNoteStyles";
import { slashMenuFloatingOptions } from "./blocknote/slashMenuFloatingOptions";
import { SUGGESTION_MENU_ID, suggestionMenuItemId } from "./blocknote/suggestionMenuIds";

const menuTitle = (items: NoteMentionMenuItem[]) => {
  if (items.length > 0 && items.every((item) => item.section === "Video")) {
    return "Video timestamps";
  }
  if (items.length > 0 && items.every((item) => item.section === "Notes")) {
    return "Link to note";
  }
  return "References";
};

function NoteMentionMenu({
  items,
  selectedIndex,
  onItemClick,
}: SuggestionMenuProps<NoteMentionMenuItem>) {
  const showGroupLabels = new Set(items.map((item) => item.section)).size > 1;
  return (
    <div id={SUGGESTION_MENU_ID} className={styles.slashMenuShell}>
      <div
        className={styles.slashMenu}
        role="listbox"
        aria-label="Note mentions"
        aria-activedescendant={
          selectedIndex !== undefined ? suggestionMenuItemId(selectedIndex) : undefined
        }
        tabIndex={0}
      >
        <div className={cn(dropdownLabelClass, "flex items-center")} role="presentation">
          <span className="truncate">{menuTitle(items)}</span>
        </div>
        <div
          className="flex max-h-[calc(var(--editor-popup-max-height)-76px)] scroll-pb-(--editor-popup-padding) flex-col overflow-y-auto"
          role="presentation"
        >
          {items.map((item, index) => {
            const sectionChanged = index === 0 || items[index - 1]?.section !== item.section;
            return (
              <div key={item.id}>
                {showGroupLabels && sectionChanged ? (
                  <div className={dropdownLabelClass} role="presentation" aria-hidden="true">
                    {item.section}
                  </div>
                ) : null}
                <button
                  id={suggestionMenuItemId(index)}
                  type="button"
                  role="option"
                  aria-selected={selectedIndex === index}
                  tabIndex={-1}
                  className={cn(dropdownItemClass, "aria-selected:bg-(--menu-item-hover-bg)")}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onItemClick?.(item);
                  }}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="shrink-0">{item.title}</span>
                    <span className="ml-auto min-w-0 truncate text-right text-(--app-muted)">
                      {item.detail}
                    </span>
                  </span>
                </button>
              </div>
            );
          })}
          {items.length === 0 ? (
            <div className={styles.slashMenuEmpty} role="presentation">
              No notes or references found.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** The `@` menu: links to other notes and the video's current moment. */
export function NoteMentionMenuController({
  enabled,
  getItems,
  onItemClick,
}: {
  enabled: boolean;
  getItems: (query: string) => Promise<NoteMentionMenuItem[]>;
  onItemClick: (item: NoteMentionMenuItem) => void;
}) {
  if (!enabled) return null;
  return (
    <SuggestionMenuController
      triggerCharacter="@"
      getItems={getItems}
      suggestionMenuComponent={NoteMentionMenu}
      onItemClick={onItemClick}
      floatingUIOptions={slashMenuFloatingOptions}
    />
  );
}
