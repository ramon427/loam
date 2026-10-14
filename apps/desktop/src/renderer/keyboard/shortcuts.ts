/** A key with its modifiers. `mod` is Cmd on macOS and Ctrl elsewhere. */
export type ShortcutCombo = {
  key: string;
  mod?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
};

/** Every shortcut the app shows or handles by name. */
export const shortcuts = {
  "app.note.new": { key: "n", mod: true },
  "app.file.open": { key: "o", mod: true },
  "app.notes.search": { key: "f", mod: true, shiftKey: true },
  "app.sidebar.toggle": { key: "b", mod: true },
  "app.settings": { key: ",", mod: true },
  "app.chat.toggle": { key: "j", mod: true, shiftKey: true },
  "app.commands": { key: "p", mod: true, shiftKey: true },
  "entry.find": { key: "f", mod: true },
  "entry.save": { key: "s", mod: true },
  "entry.close": { key: "Escape" },
  "entry.previous": { key: "ArrowLeft", altKey: true },
  "preview.close": { key: "Escape" },
  "find.next": { key: "Enter" },
  "find.previous": { key: "Enter", shiftKey: true },
  "edit.undo": { key: "z", mod: true },
  "edit.redo": { key: "z", mod: true, shiftKey: true },
  "edit.cut": { key: "x", mod: true },
  "edit.copy": { key: "c", mod: true },
  "edit.paste": { key: "v", mod: true },
  "edit.select-all": { key: "a", mod: true },
  "graph.duplicate": { key: "d", mod: true },
  "graph.delete": { key: "Delete" },
  "graph.connect": { key: "c" },
  "graph.fit-view": { key: "0", mod: true },
  "video.timestamp": { key: "t", mod: true, shiftKey: true },
  "video.play-pause": { key: " ", mod: true, shiftKey: true },
} as const satisfies Record<string, ShortcutCombo>;

export type ShortcutId = keyof typeof shortcuts;

const isMac = () => /Mac|iPhone|iPad|iPod/i.test(navigator.platform);

type KeyEventLike = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "isComposing"
>;

/** Whether `event` is exactly `combo`: the same key and no extra modifiers. */
export const matchesShortcut = (event: KeyEventLike, combo: ShortcutCombo) => {
  // An input method editor is composing text; its keys aren't shortcuts.
  if (event.isComposing || event.key === "Process") return false;
  const mac = isMac();
  return (
    event.key.toLowerCase() === combo.key.toLowerCase() &&
    event.metaKey === Boolean(combo.mod && mac) &&
    event.ctrlKey === Boolean(combo.mod && !mac) &&
    event.shiftKey === Boolean(combo.shiftKey) &&
    event.altKey === Boolean(combo.altKey)
  );
};

const keyLabels: Record<string, string> = {
  Escape: "Esc",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  " ": "Space",
};

/** How a shortcut reads in a menu or tooltip: "⌘⇧F" on macOS, "Ctrl+Shift+F" elsewhere. */
export const formatShortcut = (id: ShortcutId) => {
  const combo: ShortcutCombo = shortcuts[id];
  const key =
    keyLabels[combo.key] ?? (combo.key.length === 1 ? combo.key.toUpperCase() : combo.key);
  if (isMac()) {
    const symbols = `${combo.mod ? "⌘" : ""}${combo.altKey ? "⌥" : ""}${combo.shiftKey ? "⇧" : ""}`;
    return symbols + (combo.key === "Enter" ? "↵" : key);
  }
  return [combo.mod && "Ctrl", combo.altKey && "Alt", combo.shiftKey && "Shift", key]
    .filter(Boolean)
    .join("+");
};

/** The shortcut in `aria-keyshortcuts` syntax, e.g. "Control+Shift+F". */
export const ariaKeyShortcut = (id: ShortcutId) => {
  const combo: ShortcutCombo = shortcuts[id];
  let key = combo.key.length === 1 ? combo.key.toUpperCase() : combo.key;
  if (key === " ") key = "Space";
  return [
    combo.mod && (isMac() ? "Meta" : "Control"),
    combo.altKey && "Alt",
    combo.shiftKey && "Shift",
    key,
  ]
    .filter(Boolean)
    .join("+");
};

const EDITABLE_SELECTOR = [
  "input",
  "textarea",
  "select",
  "[contenteditable='']",
  "[contenteditable='true']",
  "[contenteditable='plaintext-only']",
  "[role='textbox']",
].join(", ");

/** Text fields and rich-text editors, where plain keys type rather than act. */
export const isEditableTarget = (target: EventTarget | null) =>
  target instanceof Element && Boolean(target.closest(EDITABLE_SELECTOR));

/**
 * A plugin's shortcut, written like "Mod+Shift+D". It needs Mod or Alt, so a plugin can't take
 * over plain typing, and can't be one of the app's own shortcuts.
 */
export const parsePluginShortcut = (text: string): ShortcutCombo | null => {
  const parts = text.split("+").map((part) => part.trim());
  const key = parts.pop();
  if (!key || (key.length !== 1 && !/^F([1-9]|1[0-2])$/.test(key))) return null;
  const combo: ShortcutCombo = { key: key.length === 1 ? key.toLowerCase() : key };
  for (const modifier of parts) {
    const name = modifier.toLowerCase();
    if (name === "mod") combo.mod = true;
    else if (name === "shift") combo.shiftKey = true;
    else if (name === "alt") combo.altKey = true;
    else return null;
  }
  if (!combo.mod && !combo.altKey) return null;
  const same = (other: ShortcutCombo) =>
    other.key.toLowerCase() === combo.key.toLowerCase() &&
    Boolean(other.mod) === Boolean(combo.mod) &&
    Boolean(other.shiftKey) === Boolean(combo.shiftKey) &&
    Boolean(other.altKey) === Boolean(combo.altKey);
  return Object.values(shortcuts).some(same) ? null : combo;
};

/** How a combo reads, as formatShortcut writes the app's own. */
export const formatCombo = (combo: ShortcutCombo) => {
  const key =
    keyLabels[combo.key] ?? (combo.key.length === 1 ? combo.key.toUpperCase() : combo.key);
  if (isMac())
    return `${combo.mod ? "⌘" : ""}${combo.altKey ? "⌥" : ""}${combo.shiftKey ? "⇧" : ""}${key}`;
  return [combo.mod && "Ctrl", combo.altKey && "Alt", combo.shiftKey && "Shift", key]
    .filter(Boolean)
    .join("+");
};
