import { useEffect, useRef } from "react";
import {
  useDictionary,
  type DefaultReactGridSuggestionItem,
  type GridSuggestionMenuProps,
} from "@blocknote/react";
import { cn } from "../../ui/cn";
import { dropdownItemClass, dropdownSurfaceClass } from "../../styles/dropdowns";

export type EmojiItem = DefaultReactGridSuggestionItem & { label: string };

export function EmojiGrid({
  items,
  selectedIndex,
  onItemClick,
  columns,
  loadingState,
}: GridSuggestionMenuProps<EmojiItem>) {
  const dictionary = useDictionary();
  const selectedCell = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    selectedCell.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);
  const rows = Array.from({ length: Math.ceil(items.length / columns) }, (_, row) =>
    items.slice(row * columns, (row + 1) * columns),
  );
  return (
    <div
      id="bn-grid-suggestion-menu"
      role="grid"
      aria-label={dictionary.slash_menu.emoji.title}
      aria-busy={loadingState !== "loaded"}
      className={cn(dropdownSurfaceClass, "bn-grid-suggestion-menu max-h-72 overflow-y-auto p-1")}
    >
      {rows.map((row, rowIndex) => (
        <div
          role="row"
          key={row[0]?.id}
          className="grid"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {row.map((item, columnIndex) => {
            const index = rowIndex * columns + columnIndex;
            const selected = index === selectedIndex;
            return (
              <button
                type="button"
                role="gridcell"
                tabIndex={-1}
                key={item.id}
                id={`bn-grid-suggestion-menu-item-${index}`}
                ref={selected ? selectedCell : undefined}
                aria-label={item.label}
                aria-selected={selected}
                title={item.label}
                className={cn(
                  dropdownItemClass,
                  "bn-grid-suggestion-menu-item justify-center text-lg",
                )}
                data-highlighted={selected ? "" : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onItemClick?.(item)}
              >
                {item.icon}
              </button>
            );
          })}
        </div>
      ))}
      {items.length === 0 && (
        <div role="row">
          <div role="gridcell">
            {loadingState === "loaded" ? dictionary.suggestion_menu.no_items_title : "…"}
          </div>
        </div>
      )}
    </div>
  );
}
