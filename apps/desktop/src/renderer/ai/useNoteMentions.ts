import { useRef, useState } from "react";

export type MentionableNote = { id: string; title: string };
type Mention = { noteId: string; title: string };

/** How many notes the menu offers at once. */
const MAX_MATCHES = 6;
/** The longest name typed after @ that still looks for a note. */
const MAX_QUERY_CHARS = 60;

const fold = (text: string) => text.toLocaleLowerCase().normalize("NFKD");
const titleOf = (note: MentionableNote) => note.title.trim() || "Untitled";

/** The @ being typed before the caret: where it starts and what follows it, or null. */
const queryAt = (text: string, caret: number) => {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at === -1 || (at > 0 && !/\s/.test(before[at - 1]!))) return null;
  const typed = before.slice(at + 1);
  if (typed.length > MAX_QUERY_CHARS || typed.includes("\n")) return null;
  return { start: at, text: typed };
};

/**
 * Naming notes with @ while writing to the assistant: typing @ offers the
 * notes whose titles match what follows, and choosing one writes its title
 * and sends the note along with the message.
 */
export function useNoteMentions(notes: readonly MentionableNote[]) {
  const [query, setQuery] = useState<{ start: number; text: string } | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [mentioned, setMentioned] = useState<Mention[]>([]);
  // The @ just turned into a note's title. The keypress that chose it can still report the old
  // text before the next render, so this is a ref, which the same event already sees.
  const chosen = useRef<{ start: number; text: string } | null>(null);

  const matches = query
    ? notes.filter((note) => fold(titleOf(note)).includes(fold(query.text))).slice(0, MAX_MATCHES)
    : [];
  // Typing on past the end of any title closes the menu.
  const open = Boolean(query) && matches.length > 0;

  /** Follows the text and caret as they change. */
  const track = (text: string, caret: number) => {
    const found = queryAt(text, caret);
    const last = chosen.current;
    const next =
      found && last && found.start === last.start && found.text === last.text ? null : found;
    setQuery(next);
    if (next?.text !== query?.text) setHighlight(0);
  };

  /** Writes the note's title in place of what was typed after @; returns the new text and caret. */
  const choose = (note: MentionableNote, text: string) => {
    if (!query) return null;
    const title = titleOf(note);
    const inserted = `@${title} `;
    const end = query.start + 1 + query.text.length;
    setMentioned((current) =>
      current.some((mention) => mention.noteId === note.id)
        ? current
        : [...current, { noteId: note.id, title }],
    );
    setQuery(null);
    chosen.current = query;
    return {
      text: text.slice(0, query.start) + inserted + text.slice(end),
      caret: query.start + inserted.length,
    };
  };

  /** Arrow keys, Enter, Tab and Escape while the menu is open; true when the key was taken. */
  const onKey = (key: string, pick: (note: MentionableNote) => void) => {
    if (!open) return false;
    if (key === "ArrowDown" || key === "ArrowUp") {
      const step = key === "ArrowDown" ? 1 : -1;
      setHighlight((current) => (current + step + matches.length) % matches.length);
      return true;
    }
    if (key === "Enter" || key === "Tab") {
      pick(matches[highlight] ?? matches[0]!);
      return true;
    }
    if (key === "Escape") {
      setQuery(null);
      return true;
    }
    return false;
  };

  return {
    open,
    matches,
    highlight,
    track,
    choose,
    onKey,
    /** The notes the message still names, to send with it. */
    mentionsIn: (text: string) => mentioned.filter((mention) => text.includes(`@${mention.title}`)),
    reset: () => {
      setMentioned([]);
      setQuery(null);
      chosen.current = null;
    },
  };
}
