/*
 * While a suggestion menu is open, BlockNote points the editor's aria-controls
 * and aria-activedescendant at these ids, so every suggestion menu uses them.
 */
export const SUGGESTION_MENU_ID = "bn-suggestion-menu";

export const suggestionMenuItemId = (index: number) => `${SUGGESTION_MENU_ID}-item-${index}`;
