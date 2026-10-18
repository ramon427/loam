import type { Api, CalendarEvent, Element, GoogleStatus, Register } from "@loam/plugin-api";

import { createChanges, type Target } from "./changes";
import { civilDate, dayNumber, localDay, localMidnight, weekdayOf } from "./dates";
import { editorView, type EditorState } from "./editorView";
import { draftChanges, draftForNew, draftFromEvent, draftProblem } from "./eventDraft";
import { createGoogleApi, GoogleApiError } from "./googleApi";
import {
  calendarColor,
  calendarName,
  canWrite,
  eventColor,
  isEditable,
  selfAttendee,
  type GCalendar,
  type GEvent,
} from "./googleEvents";
import {
  agendaMarkdown,
  dayOfIso,
  entriesIn,
  googleTime,
  gridEvent,
  isDeclined,
  isoDay,
  joinLinkOf,
  localIso,
  meetingNoteMarkdown,
  meetingNoteTitle,
  plainText,
  rangeTitle,
  stepCursor,
  timesText,
  viewRange,
  weekStartDay,
  whenText,
  type Entry,
  type ViewName,
} from "./model";
import { createSubscriptionFeeds } from "./subscriptionFeeds";
import {
  addSubscription,
  defaultName,
  migrateSubscriptions,
  normalizeUrl,
  SUBSCRIPTION_COLORS,
  urlProblem,
  type Subscription,
} from "./subscriptions";
import { createSyncEngine, syncSpan, type CalendarSync } from "./sync";

/*
 * Google Calendar in a view over the notes, as its own web app shows it: day, 3-day, week,
 * month and agenda views; events made by dragging or with C, moved and resized by dragging,
 * opened in a full editor; recurring events changed one, from one on, or all at once; and a
 * meeting note from any event. Signed in to Google (in the plugin's settings), it reads and
 * writes through $.google.calendar. Beside it, any number of calendars subscribed to by their
 * ICS address (Outlook's published calendars, Google's secret addresses) show read-only.
 *
 * The plugin store keeps `hidden` (ids of calendars switched off, `sub:<id>` for a
 * subscription), `sync:<calendarId>` (that calendar's events and sync token, see sync.ts),
 * `subscriptions` (see subscriptions.ts) and `feed:<id>` (a subscription's last good copy).
 */

const VIEW = "calendar";
const POLL_MS = 5 * 60_000;
const FOCUS_SYNC_MS = 30_000;
const STATUS_MS = 10_000;
const CALENDARS_MS = 30 * 60_000;
const FEEDS_MS = 15 * 60_000;
const FOCUS_FEEDS_MS = 2 * 60_000;
const SAVE_DELAY_MS = 600;
const DOCS_URL = "https://github.com/ramon427/loam/blob/main/docs/calendars.md";
const SLASH_WAIT_MS = 4_000;
const HOUR_HEIGHT = 48;

const VIEW_LABELS: [ViewName, string][] = [
  ["day", "Day"],
  ["3day", "3 days"],
  ["week", "Week"],
  ["month", "Month"],
  ["agenda", "Agenda"],
];

const SHORTCUTS =
  "C new event · T today · D day · X 3 days · W week · M month · A agenda · J/K or ←/→ previous and next · R refresh · Enter open · Delete delete · Ctrl+Z undo · Esc close";

type Quick = { start: string; end: string; allDay: boolean; title: string; calendarId: string };

/** How a subscribed calendar's event shows the time: Outlook's free/busy status. */
const BUSY_TEXT: Record<string, string> = {
  BUSY: "Busy",
  FREE: "Free",
  TENTATIVE: "Tentative",
  OOF: "Out of office",
  WORKINGELSEWHERE: "Working elsewhere",
};

const format = (day: number, options: Intl.DateTimeFormatOptions) =>
  new Date(localMidnight(day)).toLocaleDateString("en-US", options);

/** Shortens a long link in the details to its host, since the text can't be clicked anyway. */
function shortLinks(line: string): string {
  return line.replace(/https?:\/\/[^\s)]+/g, (url) => {
    if (url.length <= 48) return url;
    try {
      return `${new URL(url).host}/…`;
    } catch {
      return url;
    }
  });
}

const describeError = (error: unknown) => {
  if (error instanceof GoogleApiError)
    return error.status === 403
      ? "Google Calendar refused: check that the Calendar API is enabled in your Google Cloud project."
      : `Google Calendar answered ${error.status}: ${error.message}`;
  const message = error instanceof Error ? error.message : String(error);
  return message || "Google Calendar couldn't be reached.";
};

export const register: Register = (on, options) => {
  const cancelledEvents = options.cancelledEvents === "hide" ? "hide" : "show";
  const weekStart = weekStartDay(options.weekStart);
  const workStart = Math.min(23, Math.max(0, Math.round(Number(options.workingHoursStart ?? 9))));
  const workEnd = Math.min(
    24,
    Math.max(workStart + 1, Math.round(Number(options.workingHoursEnd ?? 17))),
  );
  const defaultDuration = Number(options.defaultDuration) || 60;
  const defaultReminder = String(options.defaultReminder ?? "calendar");
  const showDeclined = options.showDeclined !== false;

  let app: Api | null = null;
  let status: GoogleStatus = { state: "signed-out", email: null };
  let calendars: GCalendar[] = [];
  let calendarsAt = 0;
  const calendarKeys = new Map<string, string>();
  let hidden = new Set<string>();
  let view: ViewName = "week";
  let cursor = localDay(Date.now());
  let miniCursor: number | null = null;
  let selected: string | null = null;
  let quick: Quick | null = null;
  let editor: EditorState | null = null;
  let saving = false;
  let problem: string | null = null;
  let syncing: Promise<void> | null = null;
  let lastSync = 0;
  let covered: { from: number; to: number } | null = null;
  let lastViewRender = 0;
  let subscriptions: Subscription[] = [];
  let subscriptionsRead: Promise<void> | null = null;
  /** The subscribed calendars' settings are open in place of the calendar. */
  let managing = false;
  let newAddress = "";
  let adding = false;
  let addProblem: string | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  /** New links typed into a subscription's field and not yet used, by subscription id. */
  const pendingUrls = new Map<string, string>();
  /** The entries drawn last, by the key the grid knows them by. */
  let drawn = new Map<string, Entry>();

  const redraw = () => void app?.ui.invalidate();
  const signedIn = () => status.state === "signed-in";

  const api = createGoogleApi({
    send: (request) => {
      if (!app) throw new Error("The calendar isn't ready yet.");
      return app.google.calendar(request);
    },
  });

  const engine = createSyncEngine({
    api,
    load: async (calendarId) => (await app?.store.get<CalendarSync>(`sync:${calendarId}`)) ?? null,
    save: async (calendarId, state) => {
      if (!app) return;
      // The store holds 1 MB per plugin; a calendar that doesn't fit is synced afresh next time.
      await app.store
        .set(`sync:${calendarId}`, state)
        .catch(() => app?.store.set(`sync:${calendarId}`, null));
    },
  });

  const toast = (text: string, tone: "success" | "error" | "info" = "info", undo?: () => void) =>
    void app?.ui.toast(text, {
      tone,
      ...(undo && { action: { label: "Undo", onPress: undo }, duration: 8 }),
    });

  const feeds = createSubscriptionFeeds({
    fetch: (url, init) => {
      if (!app) throw new Error("The calendar isn't ready yet.");
      return app.net.fetch(url, init);
    },
    store: {
      get: <T,>(key: string) => app?.store.get<T>(key) ?? Promise.resolve(null),
      set: (key, value) => app?.store.set(key, value) ?? Promise.resolve(null),
    },
  });

  const changes = createChanges({
    api,
    engine,
    ask: (question) => (app ? app.ui.choose(question) : Promise.resolve(null)),
    notify: (text, { tone, undo } = {}) => toast(text, tone, undo),
    redraw,
    resync: async (calendarId) => {
      const range = currentRange();
      await engine
        .sync(calendarId, localMidnight(range.first), localMidnight(range.first + range.days))
        .catch(() => undefined);
      redraw();
    },
  });

  const currentRange = () => viewRange(view, cursor, weekStart);
  const visibleCalendars = () => calendars.filter((calendar) => !hidden.has(calendar.id));
  const writableCalendars = () => calendars.filter(canWrite);
  const defaultCalendarId = () =>
    (writableCalendars().find((calendar) => calendar.primary) ?? writableCalendars()[0])?.id ??
    "primary";

  const assignKeys = () => {
    calendarKeys.clear();
    calendars.forEach((calendar, index) => calendarKeys.set(calendar.id, `c${index}`));
  };

  const subscriptionShown = (subscription: Subscription) => !hidden.has(`sub:${subscription.id}`);

  /**
   * The events to show: the Google account's (editable) and the subscribed calendars'
   * (read-only), merged into one list.
   */
  const entries = (from: number, to: number): Entry[] =>
    entriesIn(
      [
        ...(signedIn()
          ? visibleCalendars().flatMap((calendar) =>
              engine
                .events(calendar.id)
                .filter((event) => showDeclined || !isDeclined(event))
                .map((event) => ({
                  key: `${calendarKeys.get(calendar.id)}/${event.id}`,
                  calendarId: calendar.id,
                  calendar,
                  event,
                })),
            )
          : []),
        ...feeds.entries(
          subscriptions,
          subscriptionShown,
          localMidnight(from),
          localMidnight(to),
          cancelledEvents,
        ),
      ],
      from,
      to,
    );

  /** Reads the subscriptions once, carrying over the old setting, and their cached copies. */
  const readSubscriptions = ($: Api) =>
    (subscriptionsRead ??= (async () => {
      const { list, changed } = migrateSubscriptions(
        await $.store.get("subscriptions").catch(() => null),
        options.urls,
      );
      subscriptions = list;
      if (changed) await $.store.set("subscriptions", list).catch(() => undefined);
      hidden = new Set((await $.store.get<string[]>("hidden").catch(() => null)) ?? hidden);
      await feeds.restore(list);
      redraw();
    })());

  const saveSubscriptions = ($: Api, { now = false } = {}) => {
    clearTimeout(saveTimer);
    const save = () => void $.store.set("subscriptions", subscriptions).catch(() => undefined);
    if (now) save();
    else saveTimer = setTimeout(save, SAVE_DELAY_MS);
  };

  /** Fetches the subscriptions that are due, then names the ones still named by Loam. */
  const refreshSubscriptions = async ($: Api, maxAge: number) => {
    await readSubscriptions($);
    await feeds.refresh(subscriptions, { maxAge });
    let renamed = false;
    subscriptions = subscriptions.map((subscription) => {
      const name = feeds.state(subscription.id)?.name;
      if (!subscription.autoName || !name || feeds.state(subscription.id)?.error)
        return subscription;
      renamed = true;
      return { ...subscription, name: defaultName(subscription.url, name), autoName: undefined };
    });
    if (renamed) saveSubscriptions($, { now: true });
  };

  /** Brings the calendars up to date for the days in view; one sync at a time. */
  const refresh = ($: Api, { manual = false, focus = false } = {}) => {
    syncing ??= (async () => {
      redraw();
      await Promise.all([
        syncGoogle($, manual),
        refreshSubscriptions($, manual ? 0 : focus ? FOCUS_FEEDS_MS : FEEDS_MS).catch(
          () => undefined,
        ),
      ]);
      lastSync = Date.now();
      syncing = null;
      redraw();
    })();
    return syncing;
  };

  /** Syncs the Google account's calendars for the days in view, when signed in. */
  const syncGoogle = async ($: Api, manual: boolean) => {
    try {
      status = await $.google.status();
      problem = null;
      if (!signedIn()) return;
      if (!calendars.length || manual || Date.now() - calendarsAt > CALENDARS_MS) {
        calendars = await api.calendars();
        calendarsAt = Date.now();
        assignKeys();
        const saved = await $.store.get<string[]>("hidden");
        hidden = new Set(
          saved ?? calendars.filter((calendar) => calendar.selected === false).map((c) => c.id),
        );
      }
      const range = currentRange();
      const from = localMidnight(range.first);
      const to = localMidnight(range.first + range.days);
      await Promise.all(
        visibleCalendars().map(async (calendar) => {
          await engine.restore(calendar.id);
          await engine.sync(calendar.id, from, to);
        }),
      );
      const span = syncSpan(from, to);
      covered = { from: Date.parse(span.from), to: Date.parse(span.to) };
    } catch (error) {
      problem = describeError(error);
      status = await $.google.status().catch(() => status);
      if (manual) toast(problem, "error");
    }
  };

  /** Syncs when the days in view are outside what was synced. */
  const ensureCovered = ($: Api) => {
    if (syncing) return;
    const range = currentRange();
    const from = localMidnight(range.first);
    const to = localMidnight(range.first + range.days);
    // Signed out, the status is asked again now and then, as sign-in happens in Settings.
    if (
      !lastSync ||
      (signedIn() && (!covered || from < covered.from || to > covered.to)) ||
      (!signedIn() && Date.now() - lastSync > STATUS_MS)
    )
      void refresh($);
  };

  const target = (entry: Entry): Target => ({ calendarId: entry.calendarId, event: entry.event });
  const editable = (entry: Entry | undefined) =>
    Boolean(
      entry &&
      signedIn() &&
      calendarKeys.has(entry.calendarId) &&
      isEditable(entry.event, entry.calendar),
    );

  const openView = ($: Api) => $.ui.open({ id: VIEW, title: "Calendar", place: "main" });

  const signIn = async ($: Api) => {
    try {
      status = await $.google.signIn();
      calendars = [];
      engine.clear();
      await refresh($, { manual: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast(
        /client id/i.test(message)
          ? "Add your Google Client ID first: Settings, Plugins, Google Calendar."
          : message || "Couldn't sign in to Google.",
        "error",
      );
    }
    redraw();
  };

  // Making, opening and saving events.

  const nextSlot = () => {
    const today = localDay(Date.now());
    const now = new Date();
    const start =
      cursor === today
        ? localMidnight(today) + (now.getHours() + 1) * 3_600_000
        : localMidnight(cursor) + workStart * 3_600_000;
    return { start: localIso(start), end: localIso(start + defaultDuration * 60_000) };
  };

  const openEditorFor = async (entry: Entry) => {
    // A read-only event opens in its details, which is all there is to see.
    if (!editable(entry)) {
      quick = null;
      selected = entry.key;
      redraw();
      return;
    }
    let recurrence = entry.event.recurrence;
    if (entry.event.recurringEventId) {
      const master = await api
        .get(entry.calendarId, entry.event.recurringEventId)
        .catch(() => null);
      recurrence = master?.recurrence ?? null;
    }
    const draft = draftFromEvent(entry.calendarId, entry.event, recurrence);
    editor = { target: target(entry), draft, before: { ...draft }, problem: null };
    quick = null;
    // The editor takes the event's popover's place; the calendar comes back without it.
    selected = null;
    redraw();
  };

  const openNewEditor = (range: {
    start: string;
    end: string;
    allDay: boolean;
    title?: string;
    calendarId?: string;
  }) => {
    if (!signedIn()) {
      toast("Sign in to Google in the plugin's settings to add events.", "info");
      return;
    }
    const draft = draftForNew({
      calendarId: range.calendarId ?? defaultCalendarId(),
      start: range.start,
      end: range.end,
      allDay: range.allDay,
      title: range.title,
      reminder: defaultReminder,
    });
    editor = { target: null, draft, before: null, problem: null };
    quick = null;
    selected = null;
    redraw();
  };

  const saveEditor = async () => {
    const state = editor;
    if (!state || saving) return;
    const reason = draftProblem(state.draft);
    if (reason) {
      editor = { ...state, problem: reason };
      redraw();
      return;
    }
    saving = true;
    try {
      if (!state.target) {
        const { body, conference } = draftChanges(state.draft, null);
        editor = null;
        await changes.create(state.draft.calendarId, body, { conference });
      } else {
        const { body, conference } = draftChanges(
          state.draft,
          state.before,
          state.target.event.attendees,
        );
        editor = null;
        if (Object.keys(body).length)
          await changes.update(state.target, body, {
            conference,
            guestsChanged:
              JSON.stringify(state.draft.guests) !== JSON.stringify(state.before?.guests),
          });
      }
    } finally {
      saving = false;
      redraw();
    }
  };

  const saveQuick = async () => {
    const draft = quick;
    if (!draft) return;
    quick = null;
    const { body } = draftChanges(draftForNew({ ...draft, reminder: defaultReminder }), null);
    redraw();
    await changes.create(draft.calendarId, body);
  };

  const createMeetingNote = async ($: Api, entry: Entry) => {
    try {
      const note = await $.notes.create({
        title: meetingNoteTitle(entry.event),
        markdown: meetingNoteMarkdown(entry),
      });
      await $.ui.openNote(note.id);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't create the note.", "error");
    }
  };

  const removeSelected = () => {
    const entry = selected ? drawn.get(selected) : undefined;
    if (!entry || !editable(entry)) return;
    selected = null;
    void changes.remove(target(entry));
  };

  // Subscribed calendars.

  const updateSubscription = ($: Api, id: string, patch: Partial<Subscription>, again = true) => {
    subscriptions = subscriptions.map((subscription) =>
      subscription.id === id ? { ...subscription, ...patch } : subscription,
    );
    saveSubscriptions($);
    if (again) redraw();
  };

  const subscribe = async ($: Api) => {
    const url = normalizeUrl(newAddress);
    const reason = url ? urlProblem(url) : "Paste the calendar's ICS link first.";
    if (reason) {
      addProblem = reason;
      redraw();
      return;
    }
    if (subscriptions.some((subscription) => subscription.url === url)) {
      addProblem = "That calendar is already in the list.";
      redraw();
      return;
    }
    adding = true;
    addProblem = null;
    redraw();
    await readSubscriptions($);
    subscriptions = addSubscription(subscriptions, url, defaultName(url, ""), true);
    const added = subscriptions.at(-1)!;
    saveSubscriptions($, { now: true });
    hidden.delete(`sub:${added.id}`);
    await refreshSubscriptions($, 0);
    adding = false;
    newAddress = "";
    const state = feeds.state(added.id);
    toast(
      state?.error
        ? `Added ${subscriptions.find((item) => item.id === added.id)?.name ?? "the calendar"}, but it couldn't be loaded yet.`
        : `Added ${subscriptions.find((item) => item.id === added.id)?.name ?? "the calendar"}.`,
      state?.error ? "error" : "success",
    );
    redraw();
  };

  const changeAddress = async ($: Api, subscription: Subscription, input: string) => {
    const url = normalizeUrl(input);
    if (url === subscription.url) return;
    const reason = urlProblem(url);
    if (reason) {
      toast(reason, "error");
      redraw();
      return;
    }
    updateSubscription($, subscription.id, { url });
    saveSubscriptions($, { now: true });
    await feeds.forget(subscription.id);
    await refreshSubscriptions($, 0);
    redraw();
  };

  const unsubscribe = async ($: Api, subscription: Subscription) => {
    const answer = await $.ui.choose({
      title: `Remove ${subscription.name}?`,
      description: "Its events leave Loam's calendar. The calendar itself isn't changed.",
      choices: [
        { value: "remove", label: "Remove", tone: "danger" },
        { value: "keep", label: "Keep" },
      ],
    });
    if (answer !== "remove") return;
    subscriptions = subscriptions.filter((item) => item.id !== subscription.id);
    saveSubscriptions($, { now: true });
    await feeds.forget(subscription.id);
    redraw();
  };

  const openManager = ($: Api) => {
    managing = true;
    editor = null;
    selected = null;
    quick = null;
    void readSubscriptions($);
    redraw();
  };

  const go = (next: Partial<{ view: ViewName; cursor: number }>) => {
    if (next.view) view = next.view;
    if (next.cursor !== undefined) cursor = next.cursor;
    selected = null;
    quick = null;
    miniCursor = null;
    redraw();
  };

  const onKey = ($: Api, key: string) => {
    switch (key) {
      case "c":
        openNewEditor({ ...nextSlot(), allDay: false });
        return;
      case "t":
        return go({ cursor: localDay(Date.now()) });
      case "d":
        return go({ view: "day" });
      case "x":
        return go({ view: "3day" });
      case "w":
        return go({ view: "week" });
      case "m":
        return go({ view: "month" });
      case "a":
        return go({ view: "agenda" });
      case "j":
      case "n":
      case "ArrowRight":
        return go({ cursor: stepCursor(view, cursor, 1) });
      case "k":
      case "p":
      case "ArrowLeft":
        return go({ cursor: stepCursor(view, cursor, -1) });
      case "r":
        void refresh($, { manual: true });
        return;
      case "Escape":
        if (quick) quick = null;
        else selected = null;
        redraw();
        return;
      case "Delete":
      case "Backspace":
        removeSelected();
        return;
      case "Enter": {
        const entry = selected ? drawn.get(selected) : undefined;
        if (entry) void openEditorFor(entry);
        return;
      }
      case "undo":
        void changes.undo();
        return;
      case "?":
        toast(SHORTCUTS, "info");
        return;
    }
  };

  // Drawing.

  const toolbar = ($: Api, title: string) => {
    const unit =
      view === "month" ? "month" : view === "day" ? "day" : view === "week" ? "week" : "days";
    return (
      <Box direction="row" align="center" gap={2} padding={3} wrap>
        <Button
          icon="plus"
          disabled={!signedIn()}
          onPress={() => openNewEditor({ ...nextSlot(), allDay: false })}
        >
          Create
        </Button>
        <Button variant="outline" onPress={() => go({ cursor: localDay(Date.now()) })}>
          Today
        </Button>
        <Button
          variant="ghost"
          icon="chevron-left"
          label={`Previous ${unit}`}
          onPress={() => go({ cursor: stepCursor(view, cursor, -1) })}
        />
        <Button
          variant="ghost"
          icon="chevron-right"
          label={`Next ${unit}`}
          onPress={() => go({ cursor: stepCursor(view, cursor, 1) })}
        />
        <Heading level={2}>{title}</Heading>
        <Box grow />
        {syncing ? (
          <Text size="xs" tone="muted">
            Syncing…
          </Text>
        ) : lastSync ? (
          <Text size="xs" tone="muted">
            {`Updated ${new Date(lastSync).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`}
          </Text>
        ) : null}
        <Button
          variant="ghost"
          icon="refresh"
          label="Refresh"
          disabled={syncing !== null}
          onPress={() => refresh($, { manual: true })}
        />
        <Box direction="row" gap={0}>
          {VIEW_LABELS.map(([name, label]) => (
            <Button
              size="sm"
              variant="ghost"
              selected={view === name}
              onPress={() => go({ view: name })}
            >
              {label}
            </Button>
          ))}
        </Box>
      </Box>
    );
  };

  const miniMonth = () => {
    const month = miniCursor ?? cursor;
    const { y, m } = civilDate(month);
    const monthStart = dayNumber(y, m, 1);
    const first = monthStart - ((weekdayOf(monthStart) - weekStart + 7) % 7);
    const today = localDay(Date.now());
    const range = currentRange();
    const step = (direction: number) => {
      miniCursor = stepCursor("month", monthStart, direction);
      redraw();
    };
    return (
      <Box gap={1}>
        <Box direction="row" align="center" gap={0}>
          <Box grow>
            <Text size="sm" weight="medium">
              {format(monthStart, { month: "long", year: "numeric" })}
            </Text>
          </Box>
          <Button
            size="sm"
            variant="ghost"
            icon="chevron-left"
            label="Previous month"
            onPress={() => step(-1)}
          />
          <Button
            size="sm"
            variant="ghost"
            icon="chevron-right"
            label="Next month"
            onPress={() => step(1)}
          />
        </Box>
        <Box columns={7} gap={0}>
          {Array.from({ length: 7 }, (_, index) => (
            <Box align="center">
              <Text size="xs" tone="muted">
                {format(first + index, { weekday: "narrow" })}
              </Text>
            </Box>
          ))}
          {Array.from({ length: 42 }, (_, index) => {
            const day = first + index;
            const inMonth = civilDate(day).m === m;
            const inView = view !== "month" && day >= range.first && day < range.first + range.days;
            return (
              <Box
                align="center"
                surface={inView || day === cursor}
                label={format(day, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
                onPress={() => go({ cursor: day })}
              >
                <Text
                  size="xs"
                  weight={day === today ? "semibold" : "normal"}
                  tone={day === today ? "accent" : inMonth ? "default" : "muted"}
                >
                  {String(civilDate(day).d)}
                </Text>
              </Box>
            );
          })}
        </Box>
      </Box>
    );
  };

  const sidebar = ($: Api) => (
    <Box width={236} scroll padding={3} gap={4}>
      {miniMonth()}
      {signedIn() ? (
        <Box gap={1}>
          <Text size="sm" weight="medium">
            My calendars
          </Text>
          {calendars.map((calendar) => (
            <Box direction="row" align="center" gap={2}>
              <Swatch color={calendarColor(calendar)} />
              <Checkbox
                label={calendarName(calendar).slice(0, 200)}
                checked={!hidden.has(calendar.id)}
                onChange={async (checked) => {
                  if (checked) hidden.delete(calendar.id);
                  else hidden.add(calendar.id);
                  hidden = new Set(hidden);
                  await $.store.set("hidden", [...hidden]);
                  redraw();
                  if (checked) void refresh($);
                }}
              />
            </Box>
          ))}
          {status.email ? (
            <Text size="xs" tone="muted" truncate>
              {status.email}
            </Text>
          ) : null}
        </Box>
      ) : (
        <Box gap={2}>
          <Text size="sm" weight="medium">
            {status.state === "expired" ? "Google signed you out" : "Google account"}
          </Text>
          <Text size="xs" tone="muted">
            {status.state === "expired"
              ? "Sign in again to see and change your events. An app in Testing is signed out after 7 days."
              : "Sign in to see and change your events. Add your Client ID first: Settings, Plugins, Google Calendar."}
          </Text>
          <Button
            variant="outline"
            disabled={status.state === "signing-in"}
            onPress={() => signIn($)}
          >
            {status.state === "signing-in" ? "Signing in…" : "Sign in with Google"}
          </Button>
        </Box>
      )}
      {otherCalendars($)}
    </Box>
  );

  /** The subscribed calendars, each with its color, a switch, and why it failed if it did. */
  const otherCalendars = ($: Api) => {
    const shown = subscriptions.filter((subscription) => subscription.enabled);
    return (
      <Box gap={1}>
        <Box direction="row" align="center" gap={0}>
          <Box grow>
            <Text size="sm" weight="medium">
              Other calendars
            </Text>
          </Box>
          <Button
            size="sm"
            variant="ghost"
            icon="plus"
            label="Add a calendar by link"
            onPress={() => openManager($)}
          />
          <Button
            size="sm"
            variant="ghost"
            icon="settings"
            label="Subscribed calendars"
            onPress={() => openManager($)}
          />
        </Box>
        {shown.length ? (
          shown.map((subscription) => {
            const error = feeds.state(subscription.id)?.error;
            return (
              <Box gap={0}>
                <Box direction="row" align="center" gap={2}>
                  <Swatch color={subscription.color} />
                  <Box grow>
                    <Checkbox
                      label={subscription.name}
                      checked={subscriptionShown(subscription)}
                      onChange={async (checked) => {
                        const key = `sub:${subscription.id}`;
                        hidden = new Set(hidden);
                        if (checked) hidden.delete(key);
                        else hidden.add(key);
                        redraw();
                        await $.store.set("hidden", [...hidden]);
                      }}
                    />
                  </Box>
                  {error ? <Icon name="warning" tone="warning" /> : null}
                </Box>
                {error ? (
                  <Text size="xs" tone="warning">
                    {error}
                  </Text>
                ) : null}
              </Box>
            );
          })
        ) : (
          <Text size="xs" tone="muted">
            Add your Outlook work calendar, or any other, by its ICS link.
          </Text>
        )}
      </Box>
    );
  };

  const details = ($: Api, entry: Entry, inline = false): Element => {
    const { event, calendar, extra } = entry;
    const canEdit = editable(entry);
    const join = joinLinkOf(entry);
    const self = selfAttendee(event);
    const guests = (event.attendees ?? []).filter((attendee) => !attendee.resource);
    const description = event.description ? plainText(event.description) : "";
    const lines = description.split("\n").slice(0, 12).map(shortLinks);
    const busy = extra ? BUSY_TEXT[extra.busyStatus] : undefined;
    const calendarLine = [
      calendar ? calendarName(calendar) : "",
      ...(extra ? ["Read-only"] : []),
      ...(busy ? [`Shows as ${busy}`] : []),
    ]
      .filter(Boolean)
      .join(" · ");
    return (
      <Box gap={2} padding={inline ? 2 : 0} surface={inline}>
        <Box direction="row" justify="end" gap={0}>
          {canEdit ? (
            <Button
              variant="ghost"
              size="sm"
              icon="pencil"
              label="Edit event"
              onPress={() => openEditorFor(entry)}
            />
          ) : null}
          {canEdit ? (
            <Button
              variant="ghost"
              size="sm"
              icon="trash"
              label="Delete event"
              onPress={() => {
                selected = null;
                void changes.remove(target(entry));
              }}
            />
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            icon="x"
            label="Close"
            onPress={() => {
              selected = null;
              redraw();
            }}
          />
        </Box>
        <Box direction="row" gap={2} align="start">
          <Swatch color={eventColor(event, calendar)} />
          <Box gap={0} grow>
            <Heading level={3}>{event.summary || "(No title)"}</Heading>
            <Text size="sm" tone="muted">
              {whenText(event)}
            </Text>
            {event.recurringEventId ? (
              <Text size="xs" tone="muted">
                Repeats
              </Text>
            ) : null}
          </Box>
        </Box>
        {extra?.cancelled ? (
          <Box direction="row" gap={2} align="center">
            <Badge tone="danger">Cancelled</Badge>
            <Text size="xs" tone="muted">
              The organizer called this meeting off.
            </Text>
          </Box>
        ) : null}
        {join && !extra?.cancelled ? (
          <Box direction="row">
            <Button variant="default" icon="video" href={join.url}>
              {join.label}
            </Button>
          </Box>
        ) : null}
        {event.location ? (
          <Box direction="row" gap={2} align="center">
            <Icon name="map-pin" tone="muted" />
            <Text size="sm">{event.location.split("\n")[0]!}</Text>
          </Box>
        ) : null}
        {extra?.private ? (
          <Box direction="row" gap={2} align="center">
            <Icon name="lock" tone="muted" />
            <Text size="xs" tone="muted">
              Private: the calendar shares only that this time is taken.
            </Text>
          </Box>
        ) : null}
        {extra && event.organizer?.displayName ? (
          <Text size="xs" tone="muted">
            {`Organizer: ${event.organizer.displayName}`}
          </Text>
        ) : null}
        {guests.length ? (
          <Box gap={0}>
            <Text size="sm" weight="medium">
              {guests.length === 1 ? "1 guest" : `${guests.length} guests`}
            </Text>
            {guests.slice(0, 8).map((attendee) => (
              <Text size="xs" tone="muted" truncate>
                {`${attendee.displayName || attendee.email}${attendee.organizer ? " · Organizer" : ""}${
                  attendee.responseStatus === "accepted"
                    ? " · Going"
                    : attendee.responseStatus === "declined"
                      ? " · Not going"
                      : attendee.responseStatus === "tentative"
                        ? " · Maybe"
                        : ""
                }`}
              </Text>
            ))}
          </Box>
        ) : null}
        {description ? (
          <Box gap={0}>
            {lines.map((line) => (
              <Text size="xs">{line || " "}</Text>
            ))}
          </Box>
        ) : null}
        <Box direction="row" gap={2} align="center">
          <Icon name="calendar" tone="muted" />
          <Text size="xs" tone="muted">
            {calendarLine}
          </Text>
        </Box>
        {self && !self.organizer && signedIn() ? (
          <Box direction="row" gap={1} align="center">
            <Text size="sm">Going?</Text>
            {(
              [
                ["accepted", "Yes"],
                ["declined", "No"],
                ["tentative", "Maybe"],
              ] as const
            ).map(([answer, label]) => (
              <Button
                size="sm"
                variant="outline"
                selected={self.responseStatus === answer}
                onPress={() => changes.respond(target(entry), answer)}
              >
                {label}
              </Button>
            ))}
          </Box>
        ) : null}
        <Box direction="row" gap={2} align="center" wrap>
          <Button
            size="sm"
            variant="secondary"
            icon="file"
            onPress={() => createMeetingNote($, entry)}
          >
            Create meeting note
          </Button>
          {event.htmlLink ? <Link href={event.htmlLink}>Open in Google Calendar</Link> : null}
        </Box>
      </Box>
    );
  };

  const quickCreate = () => {
    const draft = quick!;
    const writable = writableCalendars();
    const preview: GEvent = {
      id: "",
      start: draft.allDay ? { date: draft.start.slice(0, 10) } : { dateTime: draft.start },
      end: draft.allDay ? { date: draft.end.slice(0, 10) } : { dateTime: draft.end },
    };
    return (
      <Box gap={2}>
        <Input
          label="Title"
          placeholder="Add title"
          autoFocus
          value={draft.title}
          onChange={(title) => {
            if (quick) quick.title = title;
          }}
          onSubmit={(title) => {
            if (quick) quick.title = title;
            void saveQuick();
          }}
        />
        <Text size="sm" tone="muted">
          {whenText(preview)}
        </Text>
        {writable.length > 1 ? (
          <Select
            label="Calendar"
            value={draft.calendarId}
            options={writable.map((calendar) => ({
              value: calendar.id,
              label: calendarName(calendar).slice(0, 200),
            }))}
            onChange={(calendarId) => {
              if (quick) quick.calendarId = calendarId;
              redraw();
            }}
          />
        ) : null}
        <Box direction="row" justify="between" align="center">
          <Button variant="ghost" onPress={() => openNewEditor(draft)}>
            More options
          </Button>
          <Button onPress={() => saveQuick()}>Save</Button>
        </Box>
      </Box>
    );
  };

  const agenda = ($: Api, first: number, days: number) => {
    const today = localDay(Date.now());
    const sections = Array.from({ length: days }, (_, index) => first + index).flatMap((day) => {
      const items = entriesIn([...drawn.values()], day, day + 1);
      if (!items.length && day !== today) return [];
      return [
        <Box direction="row" gap={4} align="start">
          <Box width={120} gap={0}>
            <Text weight="semibold" tone={day === today ? "accent" : "default"}>
              {format(day, { day: "numeric" })}
            </Text>
            <Text size="xs" tone="muted">
              {`${format(day, { weekday: "short" })}, ${format(day, { month: "short" })}`}
            </Text>
          </Box>
          <Box grow gap={1}>
            {items.length ? (
              items.map((entry) => (
                <Box gap={1}>
                  <Box
                    direction="row"
                    gap={2}
                    align="center"
                    padding={1}
                    label={`${entry.event.summary || "(No title)"}, ${timesText(entry.event, day)}`}
                    onPress={() => {
                      selected = selected === `${day}:${entry.key}` ? null : `${day}:${entry.key}`;
                      redraw();
                    }}
                  >
                    <Swatch color={eventColor(entry.event, entry.calendar)} />
                    <Box width={150}>
                      <Text size="sm" tone="muted">
                        {timesText(entry.event, day)}
                      </Text>
                    </Box>
                    <Text size="sm" weight="medium" truncate>
                      {entry.event.summary || "(No title)"}
                    </Text>
                  </Box>
                  {selected === `${day}:${entry.key}` ? details($, entry, true) : null}
                </Box>
              ))
            ) : (
              <Text size="sm" tone="muted">
                Nothing planned
              </Text>
            )}
          </Box>
        </Box>,
      ];
    });
    return (
      <Box grow scroll padding={4} gap={3}>
        {sections}
      </Box>
    );
  };

  const grid = ($: Api, range: { first: number; days: number }) => {
    const events: CalendarEvent[] = [...drawn.values()].map(gridEvent);
    const selectedEntry = selected ? drawn.get(selected) : undefined;
    const quickColor = quick
      ? calendarColor(calendars.find((calendar) => calendar.id === quick!.calendarId))
      : undefined;
    return (
      <CalendarGrid
        view={view === "agenda" ? "week" : view}
        start={isoDay(range.first)}
        days={range.days}
        events={events}
        hourHeight={HOUR_HEIGHT}
        snapMinutes={15}
        defaultDuration={defaultDuration}
        workingHours={{ start: workStart, end: workEnd }}
        selectedId={selectedEntry ? selectedEntry.key : undefined}
        draft={
          quick
            ? {
                start: quick.start,
                end: quick.end,
                allDay: quick.allDay,
                title: quick.title,
                color: quickColor,
              }
            : undefined
        }
        label="Calendar"
        onCreateRange={(range) => {
          if (!signedIn()) {
            toast("Sign in to Google in the plugin's settings to add events.", "info");
            return;
          }
          selected = null;
          quick = { ...range, title: "", calendarId: defaultCalendarId() };
          redraw();
        }}
        onMove={(move) => {
          const entry = drawn.get(move.id);
          if (!entry || !editable(entry)) return redraw();
          const zone = entry.event.start?.timeZone ?? entry.calendar?.timeZone;
          void changes.move(
            target(entry),
            googleTime(move.start, move.allDay, zone),
            googleTime(move.end, move.allDay, zone),
            "Event moved",
          );
        }}
        onResize={(resize) => {
          const entry = drawn.get(resize.id);
          if (!entry || !editable(entry)) return redraw();
          const allDay = Boolean(entry.event.start?.date);
          const zone = entry.event.start?.timeZone ?? entry.calendar?.timeZone;
          void changes.move(
            target(entry),
            googleTime(resize.start, allDay, zone),
            googleTime(resize.end, allDay, zone),
            "Event resized",
          );
        }}
        onSelect={({ id }) => {
          quick = null;
          selected = id;
          redraw();
        }}
        onOpen={({ id }) => {
          const entry = drawn.get(id);
          if (entry) void openEditorFor(entry);
        }}
        onKey={({ key }) => onKey($, key)}
        onDismiss={() => {
          quick = null;
          selected = null;
          redraw();
        }}
        onDayPress={({ date }) => go({ view: "day", cursor: dayOfIso(date) })}
      >
        {quick ? quickCreate() : selectedEntry ? details($, selectedEntry) : null}
      </CalendarGrid>
    );
  };

  const banner = ($: Api) => {
    if (signedIn() || subscriptions.length) {
      if (!problem) return null;
      return (
        <Box direction="row" gap={2} align="center" padding={2}>
          <Icon name="warning" tone="warning" />
          <Text size="sm" tone="warning">
            {problem}
          </Text>
        </Box>
      );
    }
    return (
      <Box padding={3}>
        <Box surface padding={4} gap={2}>
          <Text weight="medium">
            {status.state === "expired"
              ? "Google signed you out of Loam"
              : "Connect your calendars"}
          </Text>
          <Text size="sm" tone="muted">
            {status.state === "expired"
              ? "Sign in again. If your Google Cloud app is in Testing, Google ends the sign-in after 7 days; publish it to Production to keep it."
              : "Sign in with Google to see and change your events (add your Google Cloud Client ID in Settings, Plugins, Calendar first). Add your Outlook or Microsoft 365 calendar by its ICS link to see it beside them."}
          </Text>
          <Box direction="row" gap={2} align="center" wrap>
            <Button onPress={() => signIn($)} disabled={status.state === "signing-in"}>
              Sign in with Google
            </Button>
            <Button variant="outline" icon="plus" onPress={() => openManager($)}>
              Add a calendar by link
            </Button>
            <Link href={DOCS_URL}>How to set it up</Link>
          </Box>
        </Box>
      </Box>
    );
  };

  /** The colors to pick from, as a row of swatches. */
  const colorPicker = ($: Api, subscription: Subscription) => (
    <Box direction="row" gap={1} align="center">
      {SUBSCRIPTION_COLORS.map((color) => (
        <Swatch
          color={color}
          label={`Color ${SUBSCRIPTION_COLORS.indexOf(color) + 1} for ${subscription.name}`}
          selected={subscription.color === color}
          onPress={() => updateSubscription($, subscription.id, { color })}
        />
      ))}
    </Box>
  );

  const subscriptionCard = ($: Api, subscription: Subscription): Element => {
    const state = feeds.state(subscription.id);
    const loading = feeds.loading(subscription.id);
    const count = state?.events.length ?? 0;
    const pendingUrl = pendingUrls.get(subscription.id);
    return (
      <Box surface padding={3} gap={2}>
        <Box direction="row" gap={3} align="center">
          <Swatch color={subscription.color} />
          <Box grow>
            <Input
              label={`Name of ${subscription.name}`}
              value={subscription.name}
              onChange={(name) =>
                updateSubscription(
                  $,
                  subscription.id,
                  { name: name.slice(0, 100) || "Calendar", autoName: undefined },
                  false,
                )
              }
              onSubmit={() => redraw()}
            />
          </Box>
          <Checkbox
            label="Show"
            checked={subscription.enabled}
            onChange={(enabled) => {
              updateSubscription($, subscription.id, { enabled });
              saveSubscriptions($, { now: true });
              if (enabled) void refreshSubscriptions($, 0).then(redraw);
            }}
          />
        </Box>
        <Box gap={1}>
          <Text size="xs" tone="muted">
            ICS link (press Enter to use a new one)
          </Text>
          <Box direction="row" gap={2} align="center">
            <Box grow>
              <Input
                label={`ICS link of ${subscription.name}`}
                value={subscription.url}
                onChange={(url) => {
                  const changed = normalizeUrl(url) !== subscription.url;
                  if (changed !== pendingUrls.has(subscription.id)) {
                    if (changed) pendingUrls.set(subscription.id, url);
                    else pendingUrls.delete(subscription.id);
                    redraw();
                  } else if (changed) pendingUrls.set(subscription.id, url);
                }}
                onSubmit={(url) => {
                  pendingUrls.delete(subscription.id);
                  void changeAddress($, subscription, url);
                }}
              />
            </Box>
            {pendingUrl !== undefined ? (
              <Button
                size="sm"
                onPress={() => {
                  pendingUrls.delete(subscription.id);
                  void changeAddress($, subscription, pendingUrl);
                }}
              >
                Use this link
              </Button>
            ) : null}
          </Box>
        </Box>
        {colorPicker($, subscription)}
        <Box direction="row" gap={2} align="center" wrap>
          {state?.error ? <Icon name="warning" tone="warning" /> : null}
          <Box grow>
            <Text size="xs" tone={state?.error ? "warning" : "muted"}>
              {loading
                ? "Loading…"
                : !subscription.enabled
                  ? "Hidden from the calendar, and not loaded."
                  : (state?.error ??
                    (state?.fetchedAt
                      ? `Updated ${new Date(state.fetchedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} · ${count === 1 ? "1 event" : `${count} events`}`
                      : "Not loaded yet."))}
            </Text>
          </Box>
          <Button
            size="sm"
            variant="ghost"
            icon="refresh"
            label={`Refresh ${subscription.name}`}
            disabled={loading || !subscription.enabled}
            onPress={async () => {
              const pending = feeds.refresh([subscription], { maxAge: 0 });
              redraw();
              await pending;
              redraw();
            }}
          />
          <Button
            size="sm"
            variant="ghost"
            icon="trash"
            label={`Remove ${subscription.name}`}
            onPress={() => unsubscribe($, subscription)}
          />
        </Box>
      </Box>
    );
  };

  /** The subscribed calendars' settings, drawn in place of the calendar. */
  const manager = ($: Api): Element => (
    <Box grow scroll padding={6} gap={4}>
      <Box direction="row" align="center" gap={2}>
        <Button
          variant="ghost"
          icon="x"
          label="Close subscribed calendars"
          onPress={() => {
            managing = false;
            redraw();
          }}
        />
        <Heading level={2}>Subscribed calendars</Heading>
      </Box>
      <Box gap={1}>
        <Text size="sm" tone="muted">
          See another calendar beside your own, read-only, by its ICS link. For Outlook or Microsoft
          365 (your Teams meetings): Outlook on the web, Settings, Calendar, Shared calendars,
          Publish a calendar, then copy the ICS link.
        </Text>
        <Link href={DOCS_URL}>How to get the link</Link>
      </Box>
      <Box gap={1}>
        <Box direction="row" gap={2} align="center">
          <Box grow>
            <Input
              label="Calendar's ICS link"
              placeholder="https://outlook.office365.com/owa/calendar/…/calendar.ics"
              value={newAddress}
              disabled={adding}
              onChange={(value) => {
                newAddress = value;
              }}
              onSubmit={(value) => {
                newAddress = value;
                void subscribe($);
              }}
            />
          </Box>
          <Button icon="plus" disabled={adding} onPress={() => subscribe($)}>
            {adding ? "Adding…" : "Subscribe"}
          </Button>
        </Box>
        {addProblem ? (
          <Text size="sm" tone="danger">
            {addProblem}
          </Text>
        ) : null}
      </Box>
      {subscriptions.length ? (
        subscriptions.map((subscription) => subscriptionCard($, subscription))
      ) : (
        <Text size="sm" tone="muted">
          No subscribed calendars yet.
        </Text>
      )}
      <Text size="xs" tone="muted">
        Outlook updates a published calendar now and then, sometimes hours after a change; Loam
        reads it every 15 minutes while the calendar is open. Check that your organisation allows
        copying work calendars before you add one.
      </Text>
    </Box>
  );

  on("app.ready", async ($) => {
    app = $;
    status = await $.google.status().catch(() => status);
    await $.commands.register({ id: "open", title: "Open calendar" });
    await $.commands.register({ id: "subscribe", title: "Add a calendar by link" });
    await $.editor.registerSlashItem({
      id: "agenda",
      title: "Today's agenda",
      subtext: "Insert today's events from your calendars.",
      aliases: ["agenda", "calendar", "events"],
    });
    // The cached copies, so the calendar shows something before the first fetch.
    void readSubscriptions($);
    setInterval(() => {
      if (app && Date.now() - lastViewRender < POLL_MS + 60_000) void refresh(app);
    }, POLL_MS);
  });

  on("app.focus", async ($) => {
    app = $;
    if (Date.now() - lastViewRender < POLL_MS && Date.now() - lastSync > FOCUS_SYNC_MS)
      void refresh($, { focus: true });
  });

  on("command.run", { command: "open" }, async ($) => {
    app = $;
    await openView($);
  });

  on("command.run", { command: "subscribe" }, async ($) => {
    app = $;
    openManager($);
    await openView($);
  });

  on("ui.render", { slot: "sidebar.footer" }, async ($) => (
    <Button variant="ghost" icon="calendar" label="Calendar" onPress={() => openView($)} />
  ));

  on("ui.render", { slot: "view", props: { view: VIEW } }, async ($) => {
    app = $;
    lastViewRender = Date.now();
    ensureCovered($);
    const range = currentRange();
    // A day either side, for events that start before the first day or end after the last.
    drawn = new Map(
      entries(range.first - 1, range.first + range.days + 1).map((entry) => [entry.key, entry]),
    );
    if (view === "agenda")
      drawn = new Map(
        entries(range.first, range.first + range.days).map((entry) => [entry.key, entry]),
      );
    if (selected && !view.startsWith("agenda") && !drawn.has(selected)) selected = null;
    const title = rangeTitle(view, range, cursor);
    return (
      <Box grow gap={0}>
        {toolbar($, title)}
        {banner($)}
        <Box direction="row" grow gap={0}>
          {sidebar($)}
          <Box grow gap={0}>
            {managing
              ? manager($)
              : editor
                ? editorView({
                    state: editor,
                    calendars,
                    saving,
                    set: (patch, again) => {
                      if (!editor) return;
                      editor = { ...editor, draft: { ...editor.draft, ...patch }, problem: null };
                      if (again) redraw();
                    },
                    save: () => void saveEditor(),
                    close: () => {
                      editor = null;
                      redraw();
                    },
                  })
                : view === "agenda"
                  ? agenda($, range.first, range.days)
                  : grid($, range)}
          </Box>
        </Box>
      </Box>
    );
  });

  on("slash.run", { item: "agenda" }, async ($) => {
    app = $;
    const today = localDay(Date.now());
    const wait = () => new Promise((done) => setTimeout(done, SLASH_WAIT_MS));
    status = await $.google.status().catch(() => status);
    if (signedIn()) {
      const from = localMidnight(today);
      if (
        !covered ||
        from < covered.from ||
        from + 86_400_000 > covered.to ||
        Date.now() - lastSync > POLL_MS
      )
        await Promise.race([refresh($), wait()]);
    } else await Promise.race([readSubscriptions($).then(() => refresh($)), wait()]);
    const title = `Agenda for ${format(today, { weekday: "long", month: "long", day: "numeric" })}`;
    return {
      markdown: agendaMarkdown(
        title,
        entriesIn(entries(today, today + 1), today, today + 1),
        today,
      ),
    };
  });
};
