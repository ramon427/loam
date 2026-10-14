import type { SuggestionMenuProps } from "@blocknote/react";
import { useBlockNoteEditor, useExtensionState } from "@blocknote/react";
import { SuggestionMenu as SuggestionMenuExtension } from "@blocknote/core/extensions";
import type { JSX } from "react";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { SlashMenuItem } from "../slashMenuModel";
import { setSlashMenuCloseGuard } from "../slashMenuModel";
import { BlockPreviewCard } from "./BlockPreviewCard";
import { editorStyles as styles } from "./blockNoteStyles";
import { SUGGESTION_MENU_ID, suggestionMenuItemId } from "./suggestionMenuIds";

const EMPTY_STATE = "No commands found. Try another keyword or press Esc to close.";

export function BlockNoteSlashMenu({
  items,
  loadingState,
  selectedIndex,
  onItemClick,
}: SuggestionMenuProps<SlashMenuItem>) {
  const editor = useBlockNoteEditor();
  const listRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const hasPointerMovedForPreviewRef = useRef(false);
  const [hoveredPreviewItem, setHoveredPreviewItem] = useState<SlashMenuItem | null>(null);

  const query = useExtensionState(SuggestionMenuExtension, {
    selector: (state) => state?.query ?? "",
  });

  const showPreviewAfterPointerEnter = useCallback((item: SlashMenuItem) => {
    if (!hasPointerMovedForPreviewRef.current) return;
    setHoveredPreviewItem(item);
  }, []);

  const showPreviewAfterPointerMove = useCallback((item: SlashMenuItem) => {
    hasPointerMovedForPreviewRef.current = true;
    setHoveredPreviewItem(item);
  }, []);

  const hidePreviewItem = useCallback(() => {
    hasPointerMovedForPreviewRef.current = false;
    setHoveredPreviewItem(null);
  }, []);

  const renderedItems = useMemo(() => {
    let currentSection: string | null = null;
    const elements: JSX.Element[] = [];

    items.forEach((item, index) => {
      if (item.section !== currentSection) {
        currentSection = item.section;
        elements.push(
          <div
            key={`section-${currentSection}`}
            className={styles.slashMenuSection}
            role="presentation"
            aria-hidden="true"
          >
            {currentSection}
          </div>,
        );
      }

      const isActive = selectedIndex === index;
      const hint = item.badge ?? "Enter";

      elements.push(
        <button
          key={item.key}
          id={suggestionMenuItemId(index)}
          type="button"
          role="option"
          aria-selected={isActive}
          tabIndex={-1}
          className={`${styles.slashMenuItem} ${isActive ? styles.slashMenuItemActive : ""}`}
          onMouseDown={(event) => event.preventDefault()}
          onPointerEnter={() => showPreviewAfterPointerEnter(item)}
          onPointerMove={() => showPreviewAfterPointerMove(item)}
          onClick={() => {
            hidePreviewItem();
            onItemClick?.(item);
          }}
        >
          <span className={styles.slashMenuIcon} aria-hidden="true">
            {item.icon}
          </span>
          <span className={styles.slashMenuItemBody}>
            <span className={styles.slashMenuItemTitle}>{item.title}</span>
          </span>
          <span className={styles.slashMenuMeta}>
            <span className={styles.slashMenuShortcut}>{hint}</span>
          </span>
        </button>,
      );
    });

    return elements;
  }, [
    hidePreviewItem,
    items,
    onItemClick,
    selectedIndex,
    showPreviewAfterPointerEnter,
    showPreviewAfterPointerMove,
  ]);

  const visibleHoveredPreviewItem =
    hoveredPreviewItem && items.some((item) => item.key === hoveredPreviewItem.key)
      ? hoveredPreviewItem
      : null;

  useEffect(() => {
    if (selectedIndex === undefined) return;
    const activeEl = listRef.current?.querySelector<HTMLElement>(
      `#${suggestionMenuItemId(selectedIndex)}`,
    );
    activeEl?.scrollIntoView({ block: "nearest" });
  }, [items, selectedIndex]);

  const announcement = useMemo(() => {
    if (selectedIndex === undefined) return "";
    const item = items[selectedIndex];
    if (!item) return "";
    return `${item.title}, ${item.section} section`;
  }, [items, selectedIndex]);

  useEffect(() => {
    const dom = editor.domElement;
    if (!dom) return;

    dom.setAttribute("role", "combobox");
    dom.setAttribute("aria-haspopup", "listbox");
    dom.setAttribute("aria-autocomplete", "list");

    return () => {
      dom.removeAttribute("role");
      dom.removeAttribute("aria-haspopup");
      dom.removeAttribute("aria-autocomplete");
    };
  }, [editor]);

  useEffect(() => {
    if (!editor.domElement) return;

    const handler = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target)) return;
      const editorDom = editor.domElement;
      if (!editorDom?.isConnected) return;
      setSlashMenuCloseGuard();
      editor.getExtension(SuggestionMenuExtension)?.closeMenu();
    };

    window.addEventListener("pointerdown", handler, true);
    return () => {
      window.removeEventListener("pointerdown", handler, true);
    };
  }, [editor]);

  const handleEditorKeyDown = useEffectEvent((event: KeyboardEvent) => {
    // BlockNote swallows Enter while the menu is open, even with nothing to
    // pick; with no match, Enter closes the menu instead of doing nothing.
    if (event.key === "Enter" && !event.isComposing && items.length === 0) {
      editor.getExtension(SuggestionMenuExtension)?.closeMenu();
      return;
    }
    if (selectedIndex === undefined) return;
    const item = items[selectedIndex];

    if (event.key === "Enter" && !event.isComposing && item) {
      hidePreviewItem();
      return;
    }

    if (event.key === "Escape") {
      hidePreviewItem();
      return;
    }

    if (event.key !== "Tab") return;
    event.preventDefault();
    if (item) {
      hidePreviewItem();
      onItemClick?.(item);
    }
  });

  useLayoutEffect(() => {
    const editorDom = editor.domElement;
    if (!editorDom) return;

    editorDom.addEventListener("keydown", handleEditorKeyDown, true);
    return () => {
      editorDom.removeEventListener("keydown", handleEditorKeyDown, true);
    };
  }, [editor]);

  return (
    <div
      id={SUGGESTION_MENU_ID}
      className={styles.slashMenuShell}
      ref={menuRef}
      onPointerLeave={hidePreviewItem}
    >
      <div
        className={styles.slashMenu}
        role="listbox"
        tabIndex={0}
        aria-label="Slash commands"
        aria-activedescendant={
          selectedIndex !== undefined ? suggestionMenuItemId(selectedIndex) : undefined
        }
      >
        <div className={styles.slashMenuHeader} role="presentation">
          <span className={styles.slashMenuToken} aria-hidden="true">
            /
          </span>
          <span className={styles.slashMenuQuery}>{query ? query : "Type to filter..."}</span>
        </div>

        <div className={styles.slashMenuList} ref={listRef} role="presentation">
          {renderedItems}
          {items.length === 0 && loadingState !== "loading-initial" ? (
            <div className={styles.slashMenuEmpty} role="presentation">
              {EMPTY_STATE}
            </div>
          ) : null}
        </div>

        <div className={styles.slashMenuFooter} role="presentation">
          <span>Enter to insert</span>
          <span>Esc to close</span>
        </div>

        <div className={styles.srOnly} aria-live="polite">
          {announcement}
        </div>
      </div>

      {visibleHoveredPreviewItem ? (
        <BlockPreviewCard
          kind={visibleHoveredPreviewItem.preview}
          title={visibleHoveredPreviewItem.title}
          description={visibleHoveredPreviewItem.subtext}
          placement="slash-menu"
        />
      ) : null}
    </div>
  );
}
