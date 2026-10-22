import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { PuzzleIcon, TerminalIcon } from "lucide-react";

import { useExtensionCommands } from "../extensions/NotesExtensions";
import { cn } from "../ui/cn";
import { Dialog, DialogContent, DialogTitle } from "../ui/Dialog";

/** One of the app's own commands the palette offers next to plugins'. */
export type AppCommand = { id: string; title: string; shortcut?: string; run: () => void };

type Row = {
  id: string;
  title: string;
  detail?: string;
  shortcut?: string;
  run: () => void;
  /** Added by the app's extensions, such as Loam's plugins. */
  extension?: boolean;
};

const score = (title: string, words: string[]) => {
  const text = title.toLowerCase();
  if (!words.every((word) => text.includes(word))) return -1;
  return words.reduce((total, word) => total + (text.startsWith(word) ? 2 : 1), 0);
};

/**
 * Every command by name, the app's and plugins', opened with Mod+Shift+P. Typing filters; the
 * arrow keys move and Enter runs.
 */
export function CommandPalette({
  open,
  onOpenChange,
  appCommands,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appCommands: readonly AppCommand[];
}) {
  const commands = useExtensionCommands();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  /** The chosen command, run once the palette has closed and handed focus back. */
  const pending = useRef<(() => void) | null>(null);

  const rows = useMemo(() => {
    const all: Row[] = [
      ...appCommands,
      ...commands.map((command) => ({ ...command, extension: true })),
    ];
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return all;
    return all
      .map((row) => ({ row, score: score(`${row.title} ${row.detail ?? ""}`, words) }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.row);
  }, [appCommands, commands, query]);

  const index = Math.min(selected, Math.max(0, rows.length - 1));
  const close = () => {
    onOpenChange(false);
    setQuery("");
    setSelected(0);
  };
  const run = (row: Row | undefined) => {
    if (!row) return;
    pending.current = row.run;
    close();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") setSelected((index + 1) % Math.max(1, rows.length));
    else if (event.key === "ArrowUp")
      setSelected((index - 1 + rows.length) % Math.max(1, rows.length));
    else if (event.key === "Enter") run(rows[index]);
    else return;
    event.preventDefault();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent
        showCloseButton={false}
        className="top-[20%] max-w-lg translate-y-0 gap-0 p-0"
        aria-describedby={undefined}
        // After focus is back where it was, so a command that opens a dialog keeps its focus.
        onCloseAutoFocus={() => {
          const action = pending.current;
          pending.current = null;
          if (action) queueMicrotask(action);
        }}
      >
        <DialogTitle className="sr-only">Commands</DialogTitle>
        <input
          autoFocus
          role="combobox"
          aria-expanded
          aria-controls="command-palette-list"
          aria-activedescendant={rows[index] ? `command-${index}` : undefined}
          aria-label="Search commands"
          placeholder="Search commands…"
          className="h-11 w-full border-b border-(--app-border) bg-transparent px-4 text-sm text-(--app-text) outline-none placeholder:text-(--app-placeholder)"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(0);
          }}
          onKeyDown={onKeyDown}
        />
        <div id="command-palette-list" role="listbox" className="max-h-80 overflow-y-auto p-1">
          {rows.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-(--app-muted)">No commands match.</p>
          ) : (
            rows.map((row, rowIndex) => {
              const Icon = row.extension ? PuzzleIcon : TerminalIcon;
              return (
                <div
                  key={row.id}
                  id={`command-${rowIndex}`}
                  role="option"
                  aria-selected={rowIndex === index}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-(--radius-control) px-3 py-2 text-xs text-(--app-text)",
                    rowIndex === index && "bg-(--menu-item-hover-bg)",
                  )}
                  onMouseMove={() => setSelected(rowIndex)}
                  onClick={() => run(row)}
                >
                  <Icon className="size-3.5 shrink-0 text-(--app-muted)" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{row.title}</span>
                  {row.detail ? (
                    <span className="shrink-0 text-(--app-muted)">{row.detail}</span>
                  ) : null}
                  {row.shortcut ? (
                    <kbd className="shrink-0 font-sans text-[11px] text-(--app-muted)">
                      {row.shortcut}
                    </kbd>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
