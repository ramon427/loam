/*
 * Types for Loam plugins, API version 1.
 *
 * A plugin is a folder in the data folder's `plugins` folder, named after its id:
 *
 *   plugins/word-count/manifest.json   { "id": "word-count", "name": "Word count",
 *                                        "version": "1.0.0", "apiVersion": 1,
 *                                        "permissions": ["notes:read"] }
 *   plugins/word-count/main.js         one bundled ES module exporting `register`
 *
 * The module runs in a worker of its own, with no DOM, no Node and no network. Everything
 * outside it is reached through `$`, and only as far as the permissions the user granted.
 *
 * Bundle with JSX compiled to `h` and `Fragment`, e.g. esbuild
 * `--bundle --format=esm --jsx-factory=h --jsx-fragment=Fragment`.
 */

export type Permission =
  "notes:read" | "notes:write" | "ui" | "google:calendar" | `network:${string}`;

export type SettingValue = string | number | boolean;

/** A note as a plugin reads it: plain text, never the stored block format. */
export interface Note {
  id: string;
  title: string;
  updatedAt: string;
  folderId: string | null;
  projectId: string | null;
  /** The text of the note's pages, one block per line. */
  text: string;
}

export type NoteSummary = Omit<Note, "text">;

export interface FetchResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** The Google account Loam is signed in to, as a plugin sees it: never a token. */
export interface GoogleStatus {
  /** `expired`: Google ended the sign-in (after 7 days for apps in Testing), so sign in again. */
  state: "signed-out" | "signing-in" | "signed-in" | "expired";
  email: string | null;
}

/** A request to the Google Calendar API, under https://www.googleapis.com/calendar/v3. */
export interface GoogleCalendarRequest {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Such as `/calendars/primary/events`; ids in it are URL-encoded. */
  path: string;
  query?: Record<string, string | number | boolean | (string | number)[]>;
  /** JSON. */
  body?: string;
  /** Only If-Match and If-None-Match are sent. */
  headers?: Record<string, string>;
}

/** The only way a plugin reaches the app. Every method answers asynchronously. */
export interface Api {
  notes: {
    /** Needs notes:read. */
    get(noteId: string): Promise<Note>;
    /** Needs notes:read. */
    list(): Promise<NoteSummary[]>;
    /** Needs notes:read. */
    search(
      query: string,
      options?: { limit?: number },
    ): Promise<{ noteId: string; title: string; snippet: string }[]>;
    /** Notes that link to this one. Needs notes:read. */
    backlinks(noteId: string): Promise<NoteSummary[]>;
    /** Needs notes:write. */
    create(note: { title: string; markdown?: string; folderId?: string }): Promise<NoteSummary>;
    /** Fails with code CONFLICT if the note changed meanwhile. Needs notes:write. */
    setTitle(noteId: string, title: string): Promise<NoteSummary>;
    /** Adds Markdown to the end of the note's first page. Needs notes:write. */
    append(noteId: string, markdown: string): Promise<NoteSummary>;
    /** Moves the note to the trash. Needs notes:write. */
    trash(noteId: string): Promise<null>;
  };
  ui: {
    /** Needs ui. */
    toast(
      text: string,
      options?: {
        tone?: "info" | "success" | "warning" | "error";
        /** A button on the toast, such as Undo. */
        action?: { label: string; onPress: () => void };
        /** How long it shows, 1 to 30 seconds. */
        duration?: number;
      },
    ): Promise<null>;
    /**
     * Opens a pane at the window's right edge (draw it with a ui.render hook on slot "pane"),
     * or with place "main" a view over the notes, like a file opened from outside (slot
     * "view"); opening a note closes it. Needs ui.
     */
    open(pane: { id: string; title: string; place?: "side" | "main" }): Promise<null>;
    close(id: string): Promise<null>;
    /** Draws every slot again, for state kept outside $.state. */
    invalidate(): Promise<null>;
    openNote(noteId: string): Promise<null>;
    /**
     * Asks for a line of text in a dialog; resolves with it, or null if dismissed. Don't await
     * it inside a hook, which has 5 seconds to answer. Needs ui.
     */
    prompt(question: {
      title: string;
      placeholder?: string;
      value?: string;
    }): Promise<string | null>;
    /**
     * Offers up to six choices in a dialog, the first as the main button; resolves with the
     * value picked, or null if dismissed. Don't await it inside a hook. Needs ui.
     */
    choose(question: {
      title: string;
      description?: string;
      choices: { value: string; label: string; tone?: "danger" }[];
    }): Promise<string | null>;
  };
  commands: {
    /** Adds a command to the palette (Mod+Shift+P), answered by a command.run hook. */
    register(command: { id: string; title: string; key?: string }): Promise<null>;
  };
  editor: {
    /** Adds an item to the editor's slash menu, answered by a slash.run hook. */
    registerSlashItem(item: {
      id: string;
      title: string;
      subtext?: string;
      aliases?: string[];
    }): Promise<null>;
  };
  /** Values for this session; setting one draws every slot again. */
  state: {
    get<T = unknown>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<null>;
  };
  /** Values kept across sessions, up to 1 MB per plugin. */
  store: {
    get<T = unknown>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<null>;
  };
  net: {
    /** https only, to hosts granted as network:<host>; redirects are returned, not followed. */
    fetch(
      url: string,
      init?: { method?: string; headers?: Record<string, string>; body?: string },
    ): Promise<FetchResponse>;
  };
  settings: {
    /** The values of the settings the manifest declares. */
    get(): Promise<Record<string, SettingValue>>;
  };
  app: {
    activeNote(): Promise<{ noteId: string; tabId: string | null } | null>;
  };
  /** The Google account the user signs in to in Settings. Needs google:calendar. */
  google: {
    status(): Promise<GoogleStatus>;
    /** Opens Google's sign-in in the browser; resolves once it is done or fails. */
    signIn(): Promise<GoogleStatus>;
    /** Sends a Calendar API request with the account's token, which the plugin never sees. */
    calendar(request: GoogleCalendarRequest): Promise<FetchResponse>;
  };
}

/** A drawn element: what `<Box>`, `<Text>` and the rest become. */
export interface Element {
  type: string;
  props: Record<string, unknown>;
  children: (Element | string)[];
}

/** The places in the window a plugin can draw into. */
export interface Slots {
  "note.header": { noteId: string; title: string };
  "sidebar.footer": Record<string, never>;
  /** A pane the plugin opened with $.ui.open. */
  pane: { pane: string };
  /** A view over the notes the plugin opened with $.ui.open({ place: "main" }). */
  view: { view: string };
}

/** Each event's input, and what a hook on it returns. */
export interface Events {
  /** The plugin has started. */
  "app.ready": { e: Record<string, never>; result: unknown };
  /** The window came to the front, so what it shows may be out of date. */
  "app.focus": { e: Record<string, never>; result: unknown };
  /** A note is about to open. Return `{ deny: reason }` to keep it closed. */
  "note.open": { e: { noteId: string }; result: { deny?: string } };
  /** The window saved a note. */
  "note.saved": { e: { noteId: string }; result: unknown };
  /** Notes changed outside the window: by sync, an AI client or a plugin. */
  "notes.changed": { e: { changedNoteIds: string[]; deletedNoteIds: string[] }; result: unknown };
  /** One of this plugin's commands was run. */
  "command.run": { e: { command: string }; result: unknown };
  /** One of this plugin's slash menu items was picked; return Markdown to insert. */
  "slash.run": { e: { item: string; noteId: string | null }; result: { markdown?: string } | null };
  /** Draw into a slot, or return null to draw nothing there. */
  "ui.render": {
    e: { [S in keyof Slots]: { slot: S; requestId: string; props: Slots[S] } }[keyof Slots];
    result: Element | null;
  };
}

export type EventName = keyof Events;

type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

/** Runs the hooks after this one and then the app's own behaviour; `e` changes what they see. */
export type Next<E extends EventName> = (e?: Events[E]["e"]) => Promise<Events[E]["result"]>;

export type Hook<E extends EventName> = (
  $: Api,
  e: Readonly<Events[E]["e"]>,
  next: Next<E>,
) => Events[E]["result"] | Promise<Events[E]["result"]> | void | Promise<void>;

export interface On {
  <E extends EventName>(event: E, hook: Hook<E>): void;
  /** Runs only for events whose input holds every value `matcher` names. */
  <E extends EventName>(event: E, matcher: DeepPartial<Events[E]["e"]>, hook: Hook<E>): void;
}

/** What the plugin's module exports: called once as the plugin starts. */
export type Register = (on: On, options: Record<string, SettingValue>) => void | Promise<void>;

type Tone = "default" | "muted" | "accent" | "success" | "warning" | "danger";
type IconName =
  | "bell"
  | "bookmark"
  | "calendar"
  | "check"
  | "chevron-down"
  | "chevron-left"
  | "chevron-right"
  | "clock"
  | "copy"
  | "external-link"
  | "file"
  | "folder"
  | "hash"
  | "heart"
  | "info"
  | "link"
  | "list"
  | "map-pin"
  | "pencil"
  | "play"
  | "plus"
  | "refresh"
  | "search"
  | "settings"
  | "sparkles"
  | "star"
  | "tag"
  | "timer"
  | "trash"
  | "warning"
  | "x"
  | "zap";
type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
type Children = unknown;

/** An event CalendarGrid draws. */
export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  /** #rrggbb */
  color: string;
  readOnly?: boolean;
  declined?: boolean;
  tentative?: boolean;
  location?: string;
}

export interface ElementProps {
  Box: {
    direction?: "row" | "column";
    gap?: Step;
    padding?: Step;
    align?: "start" | "center" | "end" | "stretch";
    justify?: "start" | "center" | "end" | "between";
    wrap?: boolean;
    grow?: boolean;
    /** A bordered card. */
    surface?: boolean;
    /** Lays the children out in this many equal columns instead of a row or column. */
    columns?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
    /** Makes the whole box one button; put no other buttons inside it. */
    onPress?: () => void;
    /** Its accessible name, for a pressable box. */
    label?: string;
    /** A fixed width in pixels, 40 to 800. */
    width?: number;
    /** Scrolls what doesn't fit, up and down. */
    scroll?: boolean;
    children?: Children;
  };
  Text: {
    tone?: Tone;
    size?: "xs" | "sm" | "md";
    weight?: "normal" | "medium" | "semibold";
    mono?: boolean;
    truncate?: boolean;
    children?: Children;
  };
  Heading: { level?: 1 | 2 | 3; children?: Children };
  Badge: { tone?: Tone; children?: Children };
  Button: {
    variant?: "default" | "outline" | "secondary" | "ghost" | "destructive";
    size?: "default" | "sm";
    disabled?: boolean;
    icon?: IconName;
    /** Its accessible name; required for an icon-only button. */
    label?: string;
    onPress?: () => void;
    /** Shown pressed, as one of a set of toggles. */
    selected?: boolean;
    children?: Children;
  };
  Input: {
    /** "date" picks a day (YYYY-MM-DD, or "" for none); "time" a time (HH:MM). */
    type?: "text" | "date" | "time";
    /** Several lines of text, this many tall. */
    rows?: number;
    autoFocus?: boolean;
    value?: string;
    placeholder?: string;
    label?: string;
    disabled?: boolean;
    onChange?: (value: string) => void;
    onSubmit?: (value: string) => void;
    /** Empties the field once Enter submitted it, as an "add an item" field does. */
    clearOnSubmit?: boolean;
  };
  Checkbox: {
    checked?: boolean;
    label?: string;
    disabled?: boolean;
    onChange?: (checked: boolean) => void;
  };
  Select: {
    value?: string;
    options: { value: string; label: string }[];
    label?: string;
    disabled?: boolean;
    onChange?: (value: string) => void;
  };
  /** Opens an https or mailto address in the system browser. */
  Link: { href: string; children?: Children };
  /** A dot of color; pressable, as in a color picker, when given onPress. */
  Swatch: { color: string; label?: string; selected?: boolean; onPress?: () => void };
  /**
   * A calendar the window draws and runs: a time grid of 1, 3 or 7 days, or a month. Drags,
   * clicks and keys are handled in the window and reported with ISO times: a date
   * (`2026-10-19`, exclusive at the end, for all-day) or a local date-time with its offset.
   * Its children show as a popover beside the selected event or the draft.
   */
  CalendarGrid: {
    view?: "day" | "3day" | "week" | "month";
    /** The first day shown. */
    start: string;
    /** Days shown; a month shows whole weeks, such as 35 or 42. */
    days?: number;
    events: CalendarEvent[];
    hourHeight?: number;
    /** Minutes a drag snaps to; 15 unless set. */
    snapMinutes?: 5 | 10 | 15 | 30 | 60;
    /** Minutes long an event made with a click is. */
    defaultDuration?: number;
    workingHours?: { start: number; end: number };
    selectedId?: string;
    /** An event being made, drawn in place until it is saved. */
    draft?: { start: string; end: string; allDay: boolean; title?: string; color?: string };
    label?: string;
    onCreateRange?: (range: { start: string; end: string; allDay: boolean }) => void;
    onMove?: (move: { id: string; start: string; end: string; allDay: boolean }) => void;
    onResize?: (resize: { id: string; start: string; end: string }) => void;
    onSelect?: (event: { id: string }) => void;
    /** A double click, or Enter on an event. */
    onOpen?: (event: { id: string }) => void;
    /**
     * A key pressed anywhere in the view outside a text field: a letter (c, t, d, w, m, a, x,
     * j, k, n, p, r, ?), ArrowLeft, ArrowRight, Escape, Delete, Backspace, Enter, or "undo".
     */
    onKey?: (key: { key: string }) => void;
    /** A click beside the popover. */
    onDismiss?: () => void;
    onDayPress?: (day: { date: string }) => void;
    children?: Children;
  };
  Divider: Record<string, never>;
  Icon: { name: IconName; tone?: Tone };
}

declare global {
  /** The JSX factory; the worker provides it. */
  function h(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element;
  const Fragment: (props: { children?: Children }) => Element;
  const Box: (props: ElementProps["Box"]) => Element;
  const Text: (props: ElementProps["Text"]) => Element;
  const Heading: (props: ElementProps["Heading"]) => Element;
  const Badge: (props: ElementProps["Badge"]) => Element;
  const Button: (props: ElementProps["Button"]) => Element;
  const Input: (props: ElementProps["Input"]) => Element;
  const Checkbox: (props: ElementProps["Checkbox"]) => Element;
  const Select: (props: ElementProps["Select"]) => Element;
  const Link: (props: ElementProps["Link"]) => Element;
  const Swatch: (props: ElementProps["Swatch"]) => Element;
  const CalendarGrid: (props: ElementProps["CalendarGrid"]) => Element;
  const Divider: (props: ElementProps["Divider"]) => Element;
  const Icon: (props: ElementProps["Icon"]) => Element;

  namespace JSX {
    type Element = import("./index").Element;
    // Plugins draw named elements (Box, Text…), never lowercase tags.
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface IntrinsicElements {}
    interface ElementChildrenAttribute {
      children: unknown;
    }
  }
}
