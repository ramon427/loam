// @vitest-environment jsdom

import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Dialog, DialogContent, DialogTitle } from "../../ui/Dialog";
import { ShortcutHint } from "../ShortcutHint";
import { ariaKeyShortcut, formatShortcut, matchesShortcut } from "../shortcuts";
import { KeyboardShortcutsScope, useShortcuts, type Shortcut } from "../useShortcuts";

const onMac = () => vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");

const key = (init: Partial<KeyboardEvent> & { key: string }) =>
  ({
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    isComposing: false,
    ...init,
  }) as KeyboardEvent;

function Shortcuts({ list }: { list: Shortcut[] }) {
  useShortcuts(list);
  return null;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("matchesShortcut", () => {
  it("reads mod as Ctrl, or as Cmd on macOS", () => {
    const combo = { key: "b", mod: true };
    expect(matchesShortcut(key({ key: "b", ctrlKey: true }), combo)).toBe(true);
    expect(matchesShortcut(key({ key: "b", metaKey: true }), combo)).toBe(false);
    onMac();
    expect(matchesShortcut(key({ key: "b", metaKey: true }), combo)).toBe(true);
    expect(matchesShortcut(key({ key: "b", ctrlKey: true }), combo)).toBe(false);
  });

  it("needs exactly the combo's modifiers, whatever the letter's case", () => {
    const combo = { key: "f", mod: true, shiftKey: true };
    expect(matchesShortcut(key({ key: "F", ctrlKey: true, shiftKey: true }), combo)).toBe(true);
    expect(matchesShortcut(key({ key: "f", ctrlKey: true }), combo)).toBe(false);
    expect(
      matchesShortcut(key({ key: "F", ctrlKey: true, shiftKey: true, altKey: true }), combo),
    ).toBe(false);
  });

  it("ignores keys typed into an input method editor", () => {
    expect(matchesShortcut(key({ key: "Escape", isComposing: true }), { key: "Escape" })).toBe(
      false,
    );
  });
});

describe("formatShortcut", () => {
  it("spells modifiers out on Windows and Linux", () => {
    expect(formatShortcut("app.notes.search")).toBe("Ctrl+Shift+F");
    expect(formatShortcut("find.previous")).toBe("Shift+Enter");
    expect(formatShortcut("entry.close")).toBe("Esc");
    expect(formatShortcut("app.chat.toggle")).toBe("Ctrl+Shift+J");
    expect(ariaKeyShortcut("app.notes.search")).toBe("Control+Shift+F");
  });

  it("uses macOS symbols on macOS", () => {
    onMac();
    expect(formatShortcut("app.notes.search")).toBe("⌘⇧F");
    expect(formatShortcut("find.previous")).toBe("⇧↵");
    expect(formatShortcut("edit.redo")).toBe("⌘⇧Z");
    expect(ariaKeyShortcut("app.sidebar.toggle")).toBe("Meta+B");
  });
});

describe("useShortcuts", () => {
  it("runs the enabled shortcut that matches, and prevents the key's default", () => {
    const run = vi.fn();
    const disabled = vi.fn();
    render(
      <Shortcuts
        list={[
          { id: "app.sidebar.toggle", run },
          { id: "app.note.new", run: disabled, enabled: false },
        ]}
      />,
    );
    expect(fireEvent.keyDown(document.body, { key: "b", ctrlKey: true })).toBe(false);
    fireEvent.keyDown(document.body, { key: "n", ctrlKey: true });
    expect(run).toHaveBeenCalledTimes(1);
    expect(disabled).not.toHaveBeenCalled();
  });

  it("skips text fields unless the shortcut allows them", () => {
    const toggle = vi.fn();
    const search = vi.fn();
    render(
      <>
        <input aria-label="Field" />
        <Shortcuts
          list={[
            { id: "app.sidebar.toggle", run: toggle },
            { id: "app.notes.search", run: search, allowInEditable: true },
          ]}
        />
      </>,
    );
    const field = screen.getByRole("textbox", { name: "Field" });
    fireEvent.keyDown(field, { key: "b", ctrlKey: true });
    fireEvent.keyDown(field, { key: "F", ctrlKey: true, shiftKey: true });
    expect(toggle).not.toHaveBeenCalled();
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("lets the most recently registered shortcut win", () => {
    const outer = vi.fn();
    const inner = vi.fn();
    const { rerender } = render(<Shortcuts list={[{ id: "entry.close", run: outer }]} />);
    rerender(
      <>
        <Shortcuts list={[{ id: "entry.close", run: outer }]} />
        <Shortcuts list={[{ id: "entry.close", run: inner }]} />
      </>,
    );
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it("leaves keys that a component already handled", () => {
    const run = vi.fn();
    render(
      <div onKeyDown={(event) => event.preventDefault()}>
        <button type="button">Handles keys</button>
        <Shortcuts list={[{ id: "entry.close", run }]} />
      </div>,
    );
    fireEvent.keyDown(screen.getByRole("button"), { key: "Escape" });
    expect(run).not.toHaveBeenCalled();
  });

  it("still runs Escape shortcuts from the note editor, which cancels every Escape", () => {
    const run = vi.fn();
    render(
      <div className="ProseMirror" contentEditable onKeyDown={(event) => event.preventDefault()}>
        <Shortcuts list={[{ id: "entry.close", run, allowInEditable: true }]} />
      </div>,
    );
    const editor = document.querySelector(".ProseMirror")!;
    fireEvent.keyDown(editor, { key: "Escape" });
    fireEvent.keyDown(editor, { key: "s", ctrlKey: true });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("lets Escape close an open dialog instead of running a shortcut", () => {
    const run = vi.fn();
    function DialogHarness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <Shortcuts list={[{ id: "entry.close", run, allowInEditable: true }]} />
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent>
              <DialogTitle>Dialog</DialogTitle>
              <input aria-label="Name" />
            </DialogContent>
          </Dialog>
        </>
      );
    }
    render(<DialogHarness />);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Name" }), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it("ignores keys pressed inside a dialog or menu", () => {
    const run = vi.fn();
    render(
      <>
        <div role="menu">
          <button type="button">Item</button>
        </div>
        <Shortcuts list={[{ id: "app.sidebar.toggle", run }]} />
      </>,
    );
    fireEvent.keyDown(screen.getByRole("button"), { key: "b", ctrlKey: true });
    expect(run).not.toHaveBeenCalled();
  });

  it("turns off the shortcuts inside a disabled scope", () => {
    const run = vi.fn();
    render(
      <KeyboardShortcutsScope enabled={false}>
        <Shortcuts list={[{ id: "app.sidebar.toggle", run }]} />
      </KeyboardShortcutsScope>,
    );
    fireEvent.keyDown(document.body, { key: "b", ctrlKey: true });
    expect(run).not.toHaveBeenCalled();
  });

  it("ignores the Escape that dismisses the system app switcher", () => {
    const run = vi.fn();
    render(<Shortcuts list={[{ id: "entry.close", run }]} />);
    fireEvent.keyDown(document.body, { key: "Tab", altKey: true });
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(run).not.toHaveBeenCalled();
  });
});

describe("ShortcutHint", () => {
  it("names the shortcut in a tooltip and in aria-keyshortcuts", () => {
    render(
      <ShortcutHint label="Settings" shortcut="app.settings">
        <button type="button">Settings</button>
      </ShortcutHint>,
    );
    const button = screen.getByRole("button", { name: "Settings" });
    expect(button.getAttribute("aria-keyshortcuts")).toBe("Control+,");
    expect(button.parentElement?.title).toBe("Settings (Ctrl+,)");
  });
});
