import type { EmojiMartData } from "@emoji-mart/data";
import { useEffect, useId, useMemo, useState } from "react";

import { noteGraphColorHex, noteGraphNodeColors } from "@loam/shared/notes/noteGraphColors";
import type {
  NoteProjectColor,
  NoteProjectIcon as ProjectIcon,
} from "@loam/shared/notes/noteModel";
import { MAX_PROJECT_NAME_LENGTH, NOTE_PROJECT_SYMBOLS } from "@loam/shared/notes/noteProjects";

import { Button } from "../ui/Button";
import { cn } from "../ui/cn";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "../ui/Dialog";
import { Input } from "../ui/Input";
import { Label } from "../ui/Label";
import { PanelTabs } from "../ui/PanelTabs";
import type { NoteProjectDetails } from "../workspace/NotesWorkspace";

import { DEFAULT_PROJECT_ICON, NoteProjectIcon } from "./NoteProjectIcon";
import type { NotesProjectDialogState } from "./useNotesTreeCommands";

type EmojiOption = { native: string; name: string; search: string };
type EmojiCategory = { id: string; emojis: EmojiOption[] };

const CATEGORY_LABELS: Record<string, string> = {
  people: "Smileys & people",
  nature: "Animals & nature",
  foods: "Food & drink",
  activity: "Activities",
  places: "Travel & places",
  objects: "Objects",
  symbols: "Symbols",
  flags: "Flags",
};

let emojiCategories: Promise<EmojiCategory[]> | undefined;
/** The emoji set loads once, the first time a picker shows it. */
const loadEmojiCategories = () =>
  (emojiCategories ??= import("@emoji-mart/data").then((module) => {
    const data = ("default" in module ? module.default : module) as EmojiMartData;
    return data.categories.map((category) => ({
      id: category.id,
      emojis: category.emojis.flatMap((id) => {
        const emoji = data.emojis[id];
        const native = emoji?.skins[0]?.native;
        if (!emoji || !native) return [];
        const search = [emoji.name, id, ...emoji.keywords].join(" ").toLowerCase();
        return [{ native, name: emoji.name, search }];
      }),
    }));
  }));

const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

const sameIcon = (left: ProjectIcon, right: ProjectIcon) =>
  left.kind === right.kind && left.value === right.value;

/** A square choice in one of the dialog's grids. */
const choiceClass =
  "flex aspect-square items-center justify-center rounded-md hover:bg-(--app-page-2) focus-visible:outline-2 focus-visible:outline-(--focus-ring) aria-pressed:bg-(--app-accent-muted)";

function EmojiGrid({
  selected,
  onSelect,
}: {
  selected?: string;
  onSelect: (emoji: string) => void;
}) {
  const [categories, setCategories] = useState<EmojiCategory[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const searchId = useId();
  useEffect(() => {
    let cancelled = false;
    loadEmojiCategories().then(
      (loaded) => !cancelled && setCategories(loaded),
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, []);
  const shown = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (categories ?? [])
      .map((category) => ({
        ...category,
        emojis: category.emojis.filter((emoji) =>
          terms.every((term) => emoji.search.includes(term)),
        ),
      }))
      .filter((category) => category.emojis.length > 0);
  }, [categories, query]);

  let status: string | null = null;
  if (failed) status = "Emoji could not be loaded.";
  else if (!categories) status = "Loading emoji…";
  else if (shown.length === 0) status = "No emoji match.";

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={searchId} className="sr-only">
        Search emoji
      </Label>
      <Input
        id={searchId}
        type="search"
        value={query}
        placeholder="Search emoji"
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="h-56 overflow-y-auto overscroll-contain pr-1" role="group" aria-label="Emoji">
        {status ? (
          <p className="py-6 text-center text-xs text-(--app-muted)">{status}</p>
        ) : (
          shown.map((category) => (
            <section key={category.id} aria-label={CATEGORY_LABELS[category.id] ?? category.id}>
              <h3 className="sticky top-0 z-10 bg-(--raised-control-bg) py-1 text-[11px] font-medium text-(--app-muted)">
                {CATEGORY_LABELS[category.id] ?? category.id}
              </h3>
              <div className="grid grid-cols-9 gap-0.5">
                {category.emojis.map((emoji) => (
                  <button
                    key={emoji.native}
                    type="button"
                    title={emoji.name}
                    aria-label={emoji.name}
                    aria-pressed={selected === emoji.native}
                    onClick={() => onSelect(emoji.native)}
                    className={cn(choiceClass, "text-lg leading-none")}
                  >
                    {emoji.native}
                  </button>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function SymbolGrid({
  selected,
  onSelect,
}: {
  selected: ProjectIcon;
  onSelect: (icon: ProjectIcon) => void;
}) {
  // Switching from an emoji keeps the last color, or starts blue.
  const color: NoteProjectColor =
    selected.kind === "symbol" && selected.color ? selected.color : "blue";
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-8 gap-1" role="group" aria-label="Icons">
        {NOTE_PROJECT_SYMBOLS.map((symbol) => {
          const icon: ProjectIcon = { kind: "symbol", value: symbol, color };
          return (
            <button
              key={symbol}
              type="button"
              title={capitalize(symbol)}
              aria-label={capitalize(symbol)}
              aria-pressed={sameIcon(selected, icon)}
              onClick={() => onSelect(icon)}
              className={choiceClass}
            >
              <NoteProjectIcon icon={icon} className="size-[18px]" />
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Icon color">
        {noteGraphNodeColors.map((option) => (
          <button
            key={option}
            type="button"
            title={capitalize(option)}
            aria-label={capitalize(option)}
            aria-pressed={selected.kind === "symbol" && color === option}
            disabled={selected.kind !== "symbol"}
            onClick={() => selected.kind === "symbol" && onSelect({ ...selected, color: option })}
            className="size-5 rounded-full border-2 border-transparent focus-visible:outline-2 focus-visible:outline-(--focus-ring) disabled:opacity-40 aria-pressed:border-(--app-text)"
            style={{ backgroundColor: noteGraphColorHex[option] }}
          />
        ))}
      </div>
    </div>
  );
}

/** Names a project and picks its icon or emoji, for a new project or an existing one. */
export function NotesProjectDialog({
  state,
  onClose,
  onSubmit,
}: {
  state: NotesProjectDialogState | null;
  onClose: () => void;
  onSubmit: (details: NoteProjectDetails) => void;
}) {
  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[26rem]" showCloseButton={false}>
        {state ? (
          <ProjectForm
            key={state.mode === "edit" ? state.project.id : "create"}
            state={state}
            onClose={onClose}
            onSubmit={onSubmit}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ProjectForm({
  state,
  onClose,
  onSubmit,
}: {
  state: NotesProjectDialogState;
  onClose: () => void;
  onSubmit: (details: NoteProjectDetails) => void;
}) {
  const editing = state.mode === "edit" ? state.project : null;
  const initialIcon = editing?.icon ?? DEFAULT_PROJECT_ICON;
  const [name, setName] = useState(editing?.name ?? "");
  const [icon, setIcon] = useState(initialIcon);
  const [tab, setTab] = useState(initialIcon.kind === "emoji" ? "emoji" : "icons");
  const nameId = useId();
  const trimmed = name.trim().slice(0, MAX_PROJECT_NAME_LENGTH);

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed) onSubmit({ name: trimmed, icon });
      }}
    >
      <div className="grid gap-1.5">
        <DialogTitle>{editing ? "Edit project" : "New project"}</DialogTitle>
        <DialogDescription className="text-xs text-(--app-muted)">
          A project holds folders and notes. Its icon tells it apart in the sidebar.
        </DialogDescription>
      </div>
      <div className="flex items-end gap-2">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-md border border-(--app-border)"
          aria-hidden="true"
        >
          <NoteProjectIcon icon={icon} className="size-5 text-xl" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Label htmlFor={nameId} className="text-xs font-medium text-(--app-muted)">
            Project name
          </Label>
          <Input
            id={nameId}
            value={name}
            maxLength={MAX_PROJECT_NAME_LENGTH}
            autoFocus
            placeholder="Project name"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <PanelTabs
          ariaLabel="Icon type"
          value={tab}
          onChange={setTab}
          items={[
            { id: "icons", label: "Icons" },
            { id: "emoji", label: "Emoji" },
          ]}
        />
        <div role="tabpanel" aria-label={tab === "icons" ? "Icons" : "Emoji"} className="min-h-68">
          {tab === "icons" ? (
            <SymbolGrid selected={icon} onSelect={setIcon} />
          ) : (
            <EmojiGrid
              selected={icon.kind === "emoji" ? icon.value : undefined}
              onSelect={(value) => setIcon({ kind: "emoji", value })}
            />
          )}
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!trimmed}>
          {editing ? "Save" : "Create project"}
        </Button>
      </DialogFooter>
    </form>
  );
}
