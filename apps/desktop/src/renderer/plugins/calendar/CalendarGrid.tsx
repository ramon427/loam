import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import {
  addDays,
  dayKey,
  dayStart,
  formatHour,
  formatTime,
  isoLocal,
  minutesInto,
  parseEventTime,
  shiftDays,
} from "./calendarDates";
import {
  DAY_MINUTES,
  dragRange,
  edgeScrollSpeed,
  layoutDay,
  resizedEnd,
  snapMinutes,
  visibleSpans,
  type DaySpan,
} from "./calendarLayout";
import styles from "./CalendarGrid.module.css";

/*
 * A calendar a plugin draws but the window runs: a day, three days or a week as a time grid,
 * or a month. Dragging (to create, move across days, resize), clicking and the keyboard are
 * handled here, so they are smooth; the plugin hears the outcome as events with ISO times and
 * draws the grid again with what it saved. Until it does, a moved event stays where it was
 * dropped.
 */

export type CalendarGridEvent = {
  id: string;
  title: string;
  /** A date (all-day, end exclusive) or a date-time with an offset. */
  start: string;
  end: string;
  allDay: boolean;
  color: string;
  readOnly?: boolean;
  declined?: boolean;
  tentative?: boolean;
  location?: string;
};

export type CalendarGridView = "day" | "3day" | "week" | "month";

/** What the grid tells the plugin; each goes to the handler prop of the same name. */
type CalendarGridEmit = (
  name:
    | "onCreateRange"
    | "onMove"
    | "onResize"
    | "onSelect"
    | "onOpen"
    | "onKey"
    | "onDismiss"
    | "onDayPress",
  payload?: unknown,
) => void;

type Props = {
  view: CalendarGridView;
  /** The first day shown, `YYYY-MM-DD`. */
  start: string;
  /** How many days: 1, 3 or 7 in a time grid; whole weeks in a month. */
  days: number;
  events: readonly CalendarGridEvent[];
  hourHeight: number;
  snap: number;
  /** How long a click-made event is, in minutes. */
  defaultDuration: number;
  workingHours?: { start: number; end: number };
  selectedId?: string;
  draft?: { start: string; end: string; allDay: boolean; title?: string; color?: string };
  /** What the plugin draws beside the selected event or the draft, such as quick create. */
  popover: ReactNode;
  label?: string;
  /** Which handlers the plugin gave; without one, that gesture does nothing. */
  handles: ReadonlySet<string>;
  emit: CalendarGridEmit;
};

type Parsed = CalendarGridEvent & { s: number; e: number; long: boolean };

type Location = { area: "time"; day: number; minutes: number } | { area: "days"; day: number };

type Drag =
  | { kind: "create-time"; day: number; anchor: number; current: number }
  | { kind: "create-days"; anchor: number; current: number }
  | {
      kind: "move";
      event: Parsed;
      origin: Location;
      current: Location;
      /** Minutes between the event's start and where it was grabbed. */
      grab: number;
    }
  | { kind: "resize"; event: Parsed; day: number; current: number }
  | { kind: "resize-days"; event: Parsed; first: number; current: number }
  | { kind: "press"; event: Parsed };

type Shape = { s: number; e: number; allDay: boolean };

const MOVE_THRESHOLD = 4;
const MIN_EVENT_MINUTES = 22;
const KEYS = new Set(["c", "t", "d", "w", "m", "a", "x", "j", "k", "n", "p", "r", "?"]);
const SPECIAL_KEYS = new Set(["ArrowLeft", "ArrowRight", "Escape", "Delete", "Backspace", "Enter"]);

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** White or near-black text, whichever reads better on `color`. */
const textOn = (color: string) => {
  const match = /^#?([0-9a-f]{6})$/i.exec(color);
  if (!match) return "#ffffff";
  const value = Number.parseInt(match[1]!, 16);
  const channel = (shift: number) => {
    const c = ((value >> shift) & 255) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
  return luminance > 0.45 ? "#1f1f1f" : "#ffffff";
};

const eventStyle = (color: string): CSSProperties =>
  ({ "--event-color": color, "--event-text": textOn(color) }) as CSSProperties;

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
    Boolean(target.closest('[role="combobox"],[role="listbox"],[role="menu"]')));

const weekdayFormat = new Intl.DateTimeFormat([], { weekday: "short" });
const longDayFormat = new Intl.DateTimeFormat([], {
  weekday: "long",
  month: "long",
  day: "numeric",
});
const monthDayFormat = new Intl.DateTimeFormat([], { month: "short", day: "numeric" });

const timeRange = (s: number, e: number) =>
  s === e ? formatTime(s) : `${formatTime(s)} – ${formatTime(e)}`;

const zoneLabel = () => {
  const offset = -new Date().getTimezoneOffset();
  const hours = Math.trunc(offset / 60);
  const minutes = Math.abs(offset % 60);
  return `GMT${offset >= 0 ? "+" : "-"}${String(Math.abs(hours)).padStart(2, "0")}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""}`;
};

export function CalendarGrid(props: Props) {
  const { view, events, hourHeight, snap, defaultDuration, handles, emit } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const colsRef = useRef<HTMLDivElement>(null);
  const daysRowRef = useRef<HTMLDivElement>(null);
  const monthRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const month = view === "month";

  const dayStarts = useMemo(() => {
    const first = dayStart(props.start);
    return Array.from({ length: props.days }, (_, index) => addDays(first, index));
  }, [props.start, props.days]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const today = addDays(now, 0);

  // Where a dropped event shows until the plugin draws the grid again.
  const [pending, setPending] = useState<Record<string, Shape>>({});
  useEffect(() => setPending({}), [events]);

  const parsed = useMemo(
    () =>
      events.flatMap((event): Parsed[] => {
        const override = pending[event.id];
        const s = override ? override.s : parseEventTime(event.start);
        const e = override ? override.e : parseEventTime(event.end);
        const allDay = override ? override.allDay : event.allDay;
        if (!Number.isFinite(s) || !Number.isFinite(e)) return [];
        return [{ ...event, allDay, s, e: Math.max(e, s), long: !allDay && e - s >= 86_400_000 }];
      }),
    [events, pending],
  );
  const byId = useMemo(() => new Map(parsed.map((event) => [event.id, event])), [parsed]);

  const dayIndexOf = useCallback(
    (instant: number) => {
      for (let index = dayStarts.length - 1; index >= 0; index -= 1)
        if (instant >= dayStarts[index]!) return index;
      return -1;
    },
    [dayStarts],
  );

  /* ---------- dragging ---------- */

  const dragRef = useRef<Drag | null>(null);
  const pointerRef = useRef<{
    x: number;
    y: number;
    startX: number;
    startY: number;
    moved: boolean;
  }>({ x: 0, y: 0, startX: 0, startY: 0, moved: false });
  // What the drag looks like now, for drawing; the refs above are for the handlers.
  const [live, setLive] = useState<{ drag: Drag | null; moved: boolean }>({
    drag: null,
    moved: false,
  });
  const redraw = useCallback(() => {
    const current = dragRef.current;
    setLive({ drag: current ? { ...current } : null, moved: pointerRef.current.moved });
  }, []);

  const locate = useCallback(
    (x: number, y: number): Location | null => {
      if (month) {
        const grid = monthRef.current?.getBoundingClientRect();
        if (!grid) return null;
        const weeks = Math.ceil(props.days / 7);
        const row = clamp(Math.floor(((y - grid.top) / grid.height) * weeks), 0, weeks - 1);
        const column = clamp(Math.floor(((x - grid.left) / grid.width) * 7), 0, 6);
        return { area: "days", day: Math.min(props.days - 1, row * 7 + column) };
      }
      const columns = colsRef.current?.getBoundingClientRect();
      if (!columns) return null;
      const day = clamp(
        Math.floor(((x - columns.left) / columns.width) * props.days),
        0,
        props.days - 1,
      );
      const row = daysRowRef.current?.getBoundingClientRect();
      const body = scrollRef.current?.getBoundingClientRect();
      if (row && body && y < body.top && y >= row.top) return { area: "days", day };
      return {
        area: "time",
        day,
        minutes: clamp(((y - columns.top) / hourHeight) * 60, 0, DAY_MINUTES),
      };
    },
    [month, props.days, hourHeight],
  );

  /** Where a moved event lands for the drag as it is now. */
  const moveTarget = useCallback(
    (drag: Extract<Drag, { kind: "move" }>): Shape => {
      const { event, origin, current } = drag;
      if (current.area === "days" && (month || event.allDay || event.long)) {
        const delta = current.day - origin.day;
        return event.allDay
          ? { s: addDays(event.s, delta), e: addDays(event.e, delta), allDay: true }
          : { s: shiftDays(event.s, delta), e: shiftDays(event.e, delta), allDay: false };
      }
      if (current.area === "days") {
        const day = dayStarts[current.day]!;
        return { s: day, e: addDays(day, 1), allDay: true };
      }
      const length =
        event.allDay || event.long ? defaultDuration * 60_000 : Math.max(event.e - event.s, 0);
      const startMinutes = clamp(
        snapMinutes(current.minutes - drag.grab, snap),
        0,
        DAY_MINUTES - snap,
      );
      const s = dayStarts[current.day]! + startMinutes * 60_000;
      return { s, e: s + length, allDay: false };
    },
    [dayStarts, defaultDuration, month, snap],
  );

  const resizeTarget = (drag: Extract<Drag, { kind: "resize" }>): Shape => {
    const day = dayStarts[drag.day]!;
    const from = Math.max(0, minutesInto(day, drag.event.s));
    return {
      s: drag.event.s,
      e: day + resizedEnd(from, drag.current, snap) * 60_000,
      allDay: false,
    };
  };

  const resizeDaysTarget = (drag: Extract<Drag, { kind: "resize-days" }>): Shape => ({
    s: drag.event.s,
    e: addDays(dayStarts[Math.max(drag.first, drag.current)]!, 1),
    allDay: true,
  });

  const payloadOf = (shape: Shape) =>
    shape.allDay
      ? { start: dayKey(shape.s), end: dayKey(shape.e), allDay: true }
      : { start: isoLocal(shape.s), end: isoLocal(shape.e), allDay: false };

  const update = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    const pointer = pointerRef.current;
    if (Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY) > MOVE_THRESHOLD)
      pointer.moved = true;
    const location = locate(pointer.x, pointer.y);
    if (!location) return;
    switch (drag.kind) {
      case "create-time":
        drag.current = location.area === "time" ? location.minutes : 0;
        break;
      case "create-days":
      case "resize-days":
        drag.current = location.day;
        break;
      case "move":
        drag.current = location;
        break;
      case "resize":
        if (location.area === "time")
          drag.current = location.minutes + (location.day - drag.day) * DAY_MINUTES;
        break;
    }
    redraw();
  }, [locate, redraw]);

  // While a drag holds the pointer near the top or bottom, the grid scrolls by itself.
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const drag = dragRef.current;
      const scroller = scrollRef.current;
      if (drag && scroller && !month && drag.kind !== "press") {
        const box = scroller.getBoundingClientRect();
        const speed = edgeScrollSpeed(pointerRef.current.y, box.top, box.bottom);
        const inTime =
          drag.kind === "create-time" ||
          drag.kind === "resize" ||
          (drag.kind === "move" && drag.current.area === "time");
        if (speed && inTime) {
          scroller.scrollTop += speed;
          update();
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [month, update]);

  const popoverOpen = Boolean(props.popover);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-calendar-popover]")) return;
    if (popoverOpen) {
      // A click beside the popover closes it, as in Google Calendar, rather than starting more.
      if (handles.has("onDismiss")) {
        event.preventDefault();
        emit("onDismiss");
      }
      return;
    }
    if (target.closest("button")) return;
    const location = locate(event.clientX, event.clientY);
    if (!location) return;
    const element = target.closest<HTMLElement>("[data-event-id]");
    let drag: Drag;
    if (element) {
      const found = byId.get(element.dataset.eventId ?? "");
      if (!found) return;
      element.focus({ preventScroll: true });
      const canChange = !found.readOnly && handles.has("onMove");
      const resizing = target.closest("[data-resize]");
      if (!canChange) drag = { kind: "press", event: found };
      else if (resizing && location.area === "time" && handles.has("onResize"))
        drag = { kind: "resize", event: found, day: location.day, current: location.minutes };
      else if (resizing && location.area === "days" && handles.has("onResize"))
        drag = {
          kind: "resize-days",
          event: found,
          first: Math.max(0, dayIndexOf(found.s)),
          current: location.day,
        };
      else
        drag = {
          kind: "move",
          event: found,
          origin: location,
          current: location,
          grab:
            location.area === "time" && !found.allDay && !found.long
              ? location.minutes - minutesInto(dayStarts[location.day]!, found.s)
              : 0,
        };
    } else {
      if (!handles.has("onCreateRange")) return;
      drag =
        location.area === "time"
          ? {
              kind: "create-time",
              day: location.day,
              anchor: location.minutes,
              current: location.minutes,
            }
          : { kind: "create-days", anchor: location.day, current: location.day };
    }
    event.preventDefault();
    rootRef.current?.setPointerCapture(event.pointerId);
    dragRef.current = drag;
    pointerRef.current = {
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    redraw();
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    pointerRef.current.x = event.clientX;
    pointerRef.current.y = event.clientY;
    update();
  };

  const settle = (id: string, shape: Shape) =>
    setPending((current) => ({ ...current, [id]: shape }));

  // The pointer is captured by the grid, so a double click is told apart here.
  const lastPress = useRef<{ id: string; at: number } | null>(null);
  const pressed = (id: string) => {
    const at = Date.now();
    const previous = lastPress.current;
    lastPress.current = { id, at };
    if (previous && previous.id === id && at - previous.at < 450 && handles.has("onOpen")) {
      lastPress.current = null;
      emit("onOpen", { id });
    } else emit("onSelect", { id });
  };

  const finish = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    const moved = pointerRef.current.moved;
    redraw();
    if (!drag) return;
    switch (drag.kind) {
      case "press":
        pressed(drag.event.id);
        return;
      case "create-time": {
        const day = dayStarts[drag.day]!;
        const range = moved
          ? dragRange(drag.anchor, drag.current, snap)
          : (() => {
              const start = clamp(Math.floor(drag.anchor / snap) * snap, 0, DAY_MINUTES - snap);
              return { start, end: Math.min(DAY_MINUTES, start + defaultDuration) };
            })();
        emit("onCreateRange", {
          start: isoLocal(day + range.start * 60_000),
          end: isoLocal(day + range.end * 60_000),
          allDay: false,
        });
        return;
      }
      case "create-days": {
        const first = Math.min(drag.anchor, drag.current);
        const last = Math.max(drag.anchor, drag.current);
        emit("onCreateRange", {
          start: dayKey(dayStarts[first]!),
          end: dayKey(addDays(dayStarts[last]!, 1)),
          allDay: true,
        });
        return;
      }
      case "move": {
        if (!moved) {
          pressed(drag.event.id);
          return;
        }
        const shape = moveTarget(drag);
        if (
          shape.s === drag.event.s &&
          shape.e === drag.event.e &&
          shape.allDay === drag.event.allDay
        )
          return;
        settle(drag.event.id, shape);
        emit("onMove", { id: drag.event.id, ...payloadOf(shape) });
        return;
      }
      case "resize":
      case "resize-days": {
        if (!moved) {
          emit("onSelect", { id: drag.event.id });
          return;
        }
        const shape = drag.kind === "resize" ? resizeTarget(drag) : resizeDaysTarget(drag);
        if (shape.e === drag.event.e) return;
        settle(drag.event.id, shape);
        const { start, end } = payloadOf(shape);
        emit("onResize", { id: drag.event.id, start, end });
        return;
      }
    }
  };

  const cancel = useCallback(() => {
    dragRef.current = null;
    redraw();
  }, [redraw]);

  /* ---------- keyboard ---------- */

  // The calendar's own keys work anywhere in the view that holds it, outside text fields.
  useEffect(() => {
    const root = rootRef.current;
    const scope = root?.closest<HTMLElement>("[data-plugin-view]") ?? root;
    if (!scope || !handles.has("onKey")) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (dragRef.current && event.key === "Escape") {
        event.preventDefault();
        cancel();
        return;
      }
      const target = event.target as HTMLElement | null;
      if (event.key !== "Escape" && isEditable(target)) return;
      if (target?.closest('[role="dialog"]') && !scope.contains(target.closest('[role="dialog"]')))
        return;
      let key: string | null = null;
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "z")
        key = event.shiftKey ? "redo" : "undo";
      else if (event.ctrlKey || event.metaKey || event.altKey) return;
      else if (KEYS.has(event.key.toLowerCase())) key = event.key.toLowerCase();
      else if (SPECIAL_KEYS.has(event.key)) key = event.key;
      if (!key) return;
      event.preventDefault();
      event.stopPropagation();
      emit("onKey", { key });
    };
    scope.addEventListener("keydown", onKeyDown);
    return () => scope.removeEventListener("keydown", onKeyDown);
  }, [cancel, emit, handles]);

  const onEventKeyDown = (event: ReactKeyboardEvent<HTMLElement>, item: Parsed) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      emit("onOpen", { id: item.id });
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      emit("onSelect", { id: item.id });
      return;
    }
    if (!event.altKey || item.readOnly || !event.key.startsWith("Arrow")) return;
    event.preventDefault();
    event.stopPropagation();
    const up = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    const across = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (event.shiftKey && up && !item.allDay && handles.has("onResize")) {
      const e = Math.max(item.s + snap * 60_000, item.e + up * snap * 60_000);
      settle(item.id, { s: item.s, e, allDay: false });
      emit("onResize", { id: item.id, start: isoLocal(item.s), end: isoLocal(e) });
      return;
    }
    if (!handles.has("onMove")) return;
    const shape: Shape = across
      ? item.allDay
        ? { s: addDays(item.s, across), e: addDays(item.e, across), allDay: true }
        : { s: shiftDays(item.s, across), e: shiftDays(item.e, across), allDay: false }
      : item.allDay
        ? { s: item.s, e: item.e, allDay: true }
        : { s: item.s + up * snap * 60_000, e: item.e + up * snap * 60_000, allDay: false };
    if (shape.s === item.s && shape.e === item.e) return;
    settle(item.id, shape);
    emit("onMove", { id: item.id, ...payloadOf(shape) });
  };

  /* ---------- scrolling to now ---------- */

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const showsToday = dayStarts.includes(addDays(Date.now(), 0));
    const hour = showsToday
      ? new Date().getHours() + new Date().getMinutes() / 60 - 1.5
      : (props.workingHours?.start ?? 8) - 0.5;
    scroller.scrollTop = Math.max(0, hour * hourHeight);
    // Scrolls when the grid first shows or switches to a time grid, not on every redraw.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // The header lines up with the columns under it, whatever the scrollbar takes.
  const [scrollbarGap, setScrollbarGap] = useState(0);
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const measure = () => setScrollbarGap(scroller.offsetWidth - scroller.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [view]);

  /* ---------- the popover's place ---------- */

  const [popoverAt, setPopoverAt] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    const popover = popoverRef.current;
    if (!popoverOpen || !root || !popover) {
      setPopoverAt(null);
      return;
    }
    const anchor =
      root.querySelector<HTMLElement>("[data-draft]") ??
      (props.selectedId
        ? root.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(props.selectedId)}"]`)
        : null);
    const box = root.getBoundingClientRect();
    const width = popover.offsetWidth;
    const height = popover.offsetHeight;
    if (!anchor) {
      setPopoverAt({ left: (box.width - width) / 2, top: Math.max(8, (box.height - height) / 3) });
      return;
    }
    const at = anchor.getBoundingClientRect();
    const gap = 10;
    const right = at.right - box.left + gap;
    const left =
      right + width <= box.width - 8
        ? right
        : at.left - box.left - gap - width >= 8
          ? at.left - box.left - gap - width
          : clamp(at.left - box.left, 8, box.width - width - 8);
    const top = clamp(at.top - box.top, 8, Math.max(8, box.height - height - 8));
    setPopoverAt({ left, top });
  }, [popoverOpen, props.selectedId, props.draft, props.popover, pending, view, props.start]);

  // How many bars fit in a week of the month, from the height a week has.
  const [monthRows, setMonthRows] = useState(3);
  const weekRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const week = weekRef.current;
    if (!month || !week) return;
    const measure = () => setMonthRows(Math.max(1, Math.floor((week.clientHeight - 30) / 22)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(week);
    return () => observer.disconnect();
  }, [month]);

  /* ---------- drawing ---------- */

  const { drag, moved } = live;
  const preview: { id: string; shape: Shape } | null =
    drag && moved
      ? drag.kind === "move"
        ? { id: drag.event.id, shape: moveTarget(drag) }
        : drag.kind === "resize"
          ? { id: drag.event.id, shape: resizeTarget(drag) }
          : drag.kind === "resize-days"
            ? { id: drag.event.id, shape: resizeDaysTarget(drag) }
            : null
      : null;

  const draft: Parsed | null = props.draft
    ? (() => {
        const s = parseEventTime(props.draft.start);
        const e = parseEventTime(props.draft.end);
        return Number.isFinite(s) && Number.isFinite(e)
          ? {
              id: "\u0000draft",
              title: props.draft.title || "(No title)",
              start: props.draft.start,
              end: props.draft.end,
              allDay: props.draft.allDay,
              color: props.draft.color ?? "#039be5",
              s,
              e,
              long: !props.draft.allDay && e - s >= 86_400_000,
            }
          : null;
      })()
    : null;

  /** The events to draw: the preview in place of what is dragged, plus the draft. */
  const shown = (() => {
    const list: (Parsed & { ghost?: boolean; origin?: boolean })[] = [];
    for (const event of parsed) {
      if (preview && preview.id === event.id) {
        list.push({ ...event, origin: true });
        list.push({
          ...event,
          ...preview.shape,
          id: `${event.id}\u0000ghost`,
          ghost: true,
          long: !preview.shape.allDay && preview.shape.e - preview.shape.s >= 86_400_000,
        });
      } else list.push(event);
    }
    if (draft) list.push(draft);
    return list;
  })();

  const isBar = (event: Parsed) => event.allDay || event.long;

  const eventLabel = (event: Parsed) => {
    const when = event.allDay
      ? `${longDayFormat.format(event.s)}, all day`
      : `${longDayFormat.format(event.s)}, ${timeRange(event.s, event.e)}`;
    return `${event.title || "(No title)"}, ${when}${event.declined ? ", declined" : ""}${event.location ? `, ${event.location}` : ""}`;
  };

  const elementProps = (event: Parsed & { ghost?: boolean; origin?: boolean }) => {
    const real = !event.ghost && event.id !== "\u0000draft";
    return {
      ...(real && {
        "data-event-id": event.id,
        role: "button",
        tabIndex: 0,
        "aria-label": eventLabel(event),
        "aria-pressed": props.selectedId === event.id,
        onKeyDown: (keyEvent: ReactKeyboardEvent<HTMLElement>) => onEventKeyDown(keyEvent, event),
      }),
      "data-selected": props.selectedId === event.id,
      "data-readonly": event.readOnly === true,
      "data-declined": event.declined === true,
      "data-tentative": event.tentative === true,
      "data-ghost": event.ghost === true,
      "data-origin": event.origin === true,
      "data-draft": event.id === "\u0000draft" ? "true" : undefined,
      "data-past": real && !event.allDay && event.e < now,
      style: eventStyle(event.color),
    };
  };

  /** The bars for a row of days (the all-day row, or one week of a month). */
  const bars = (first: number, count: number, maxRows: number, dots: boolean) => {
    const rowStart = dayStarts[first]!;
    const rowEnd = addDays(dayStarts[first + count - 1]!, 1);
    const inRow = shown.filter(
      (event) =>
        (dots || isBar(event)) && event.s < rowEnd && Math.max(event.e, event.s + 1) > rowStart,
    );
    const spans: DaySpan[] = inRow.map((event) => ({
      id: event.id,
      first: Math.max(0, dayIndexOf(event.s) - first),
      last: Math.min(count - 1, dayIndexOf(Math.max(event.s, event.e - 1)) - first),
    }));
    const { shown: placed, hidden, rows } = visibleSpans(spans, count, maxRows);
    const index = new Map(inRow.map((event) => [event.id, event]));
    return {
      rows,
      nodes: [
        ...placed.map((span) => {
          const event = index.get(span.id)!;
          const dot = dots && !isBar(event);
          const extendsRight = isBar(event) && event.e > addDays(dayStarts[first + span.last]!, 1);
          return (
            <div
              key={event.id}
              className={styles.bar}
              data-dot={dot}
              {...elementProps(event)}
              style={{
                ...eventStyle(event.color),
                left: `calc(${(span.first / count) * 100}% + 2px)`,
                width: `calc(${((span.last - span.first + 1) / count) * 100}% - 5px)`,
                top: `calc(${span.row} * var(--bar-height) + var(--bars-top, 2px))`,
              }}
            >
              {dot ? (
                <>
                  <span className={styles.dot} aria-hidden />
                  <span className={styles.barTime}>{formatTime(event.s)}</span>
                </>
              ) : null}
              <span className={styles.title}>{event.title || "(No title)"}</span>
              {!dot &&
              !event.readOnly &&
              !extendsRight &&
              handles.has("onResize") &&
              event.allDay ? (
                <span className={styles.resizeX} data-resize aria-hidden />
              ) : null}
            </div>
          );
        }),
        ...hidden.flatMap((count_, day) =>
          count_
            ? [
                <button
                  key={`more-${day}`}
                  type="button"
                  className={styles.more}
                  style={{
                    left: `calc(${(day / count) * 100}% + 2px)`,
                    width: `calc(${100 / count}% - 5px)`,
                    top: `calc(${rows - 1} * var(--bar-height) + var(--bars-top, 2px))`,
                  }}
                  onClick={() => emit("onDayPress", { date: dayKey(dayStarts[first + day]!) })}
                >
                  {`${count_} more`}
                </button>,
              ]
            : [],
        ),
      ],
    };
  };

  const createDaysSelection = (first: number, count: number) => {
    if (!drag || drag.kind !== "create-days") return null;
    const from = Math.max(Math.min(drag.anchor, drag.current), first);
    const to = Math.min(Math.max(drag.anchor, drag.current), first + count - 1);
    if (from > to) return null;
    return (
      <div
        className={styles.selection}
        style={{
          left: `calc(${((from - first) / count) * 100}% + 1px)`,
          width: `calc(${((to - from + 1) / count) * 100}% - 3px)`,
          top: 1,
          bottom: 1,
        }}
      />
    );
  };

  const rootProps = {
    ref: rootRef,
    className: styles.root,
    role: "group",
    "aria-label": props.label ?? "Calendar",
    "data-dragging": Boolean(drag && moved && drag.kind !== "press"),
    onPointerDown,
    onPointerMove,
    onPointerUp: finish,
    onPointerCancel: cancel,
    onLostPointerCapture: () => finish(),
    style: {
      "--hour-height": `${hourHeight}px`,
      "--scrollbar-gap": `${scrollbarGap}px`,
    } as CSSProperties,
  };

  const popoverNode = popoverOpen ? (
    <div
      ref={popoverRef}
      className={styles.popover}
      data-calendar-popover
      role="dialog"
      aria-label="Event"
      style={popoverAt ? { left: popoverAt.left, top: popoverAt.top } : { visibility: "hidden" }}
    >
      {props.popover}
    </div>
  ) : null;

  if (month) {
    const weeks = Math.ceil(props.days / 7);
    const firstMonth = new Date(dayStarts[Math.min(dayStarts.length - 1, 7)]!).getMonth();
    return (
      <div {...rootProps}>
        <div className={styles.monthHead}>
          {dayStarts.slice(0, 7).map((day) => (
            <div key={day} className={styles.monthWeekday}>
              {weekdayFormat.format(day)}
            </div>
          ))}
        </div>
        <div
          ref={monthRef}
          className={styles.month}
          style={{ gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: weeks }, (_, week) => {
            const first = week * 7;
            const count = Math.min(7, props.days - first);
            const row = bars(first, count, monthRows, true);
            return (
              <div
                key={week}
                ref={week === 0 ? weekRef : undefined}
                className={styles.week}
                style={{ "--bars-top": "30px" } as CSSProperties}
              >
                {dayStarts.slice(first, first + count).map((day) => (
                  <div
                    key={day}
                    className={styles.cell}
                    data-outside={new Date(day).getMonth() !== firstMonth}
                  >
                    <button
                      type="button"
                      className={styles.cellDate}
                      data-today={day === today}
                      aria-label={longDayFormat.format(day)}
                      onClick={() => emit("onDayPress", { date: dayKey(day) })}
                    >
                      {new Date(day).getDate() === 1
                        ? monthDayFormat.format(day)
                        : new Date(day).getDate()}
                    </button>
                  </div>
                ))}
                {row.nodes}
                {createDaysSelection(first, count)}
              </div>
            );
          })}
        </div>
        {popoverNode}
      </div>
    );
  }

  /* ---------- the time grid ---------- */

  const columns = `var(--gutter) repeat(${props.days}, minmax(0, 1fr))`;
  const allDay = bars(0, props.days, 4, false);
  const nowDay = dayStarts.indexOf(today);

  return (
    <div {...rootProps}>
      <div className={styles.head} style={{ gridTemplateColumns: columns }}>
        <div />
        {dayStarts.map((day) => (
          <button
            key={day}
            type="button"
            className={styles.dayHead}
            data-today={day === today}
            aria-label={longDayFormat.format(day)}
            onClick={() => emit("onDayPress", { date: dayKey(day) })}
          >
            <span className={styles.weekday}>{weekdayFormat.format(day)}</span>
            <span className={styles.date}>{new Date(day).getDate()}</span>
          </button>
        ))}
      </div>
      <div className={styles.allDayRow} style={{ gridTemplateColumns: "var(--gutter) 1fr" }}>
        <div className={styles.zone}>{zoneLabel()}</div>
        <div
          ref={daysRowRef}
          className={styles.allDayCols}
          aria-label="All day"
          style={{ height: `calc(${Math.max(1, allDay.rows)} * var(--bar-height) + 6px)` }}
        >
          {dayStarts.map((day, index) => (
            <div
              key={day}
              className={styles.columnLine}
              style={{ left: `${(index / props.days) * 100}%` }}
            />
          ))}
          {allDay.nodes}
          {createDaysSelection(0, props.days)}
        </div>
      </div>
      <div ref={scrollRef} className={styles.scroll}>
        <div className={styles.body} style={{ height: hourHeight * 24 }}>
          <div className={styles.hours} aria-hidden>
            {Array.from({ length: 23 }, (_, index) => (
              <span
                key={index}
                className={styles.hourLabel}
                style={{ top: (index + 1) * hourHeight }}
              >
                {formatHour(index + 1)}
              </span>
            ))}
          </div>
          <div
            ref={colsRef}
            className={styles.cols}
            style={{ gridTemplateColumns: `repeat(${props.days}, minmax(0, 1fr))` }}
          >
            {dayStarts.map((day, index) => {
              const dayEnd = addDays(day, 1);
              const timed = shown.filter(
                (event) => !isBar(event) && event.s < dayEnd && event.e > day,
              );
              const segments = timed.map((event) => ({
                id: event.id,
                start: Math.max(0, minutesInto(day, event.s)),
                end: Math.min(DAY_MINUTES, minutesInto(day, event.e)),
              }));
              const placements = layoutDay(
                segments.filter((segment) => !segment.id.endsWith("\u0000ghost")),
                MIN_EVENT_MINUTES,
              );
              const working = props.workingHours;
              return (
                <div key={day} className={styles.col} aria-label={longDayFormat.format(day)}>
                  {working && working.end > working.start ? (
                    <>
                      <div
                        className={styles.offHours}
                        style={{ top: 0, height: working.start * hourHeight }}
                      />
                      <div
                        className={styles.offHours}
                        style={{ top: working.end * hourHeight, bottom: 0 }}
                      />
                    </>
                  ) : null}
                  {timed.map((event, position) => {
                    const segment = segments[position]!;
                    const ghost = event.id.endsWith("\u0000ghost") || event.id === "\u0000draft";
                    const placement = ghost
                      ? { left: 0, width: 1 }
                      : (placements.get(event.id) ?? { left: 0, width: 1 });
                    const height = ((segment.end - segment.start) / 60) * hourHeight;
                    const compact = height < 34;
                    const showResize =
                      !event.readOnly &&
                      !ghost &&
                      handles.has("onResize") &&
                      minutesInto(day, event.e) <= DAY_MINUTES;
                    return (
                      <div
                        key={event.id}
                        className={styles.event}
                        data-compact={compact}
                        {...elementProps(event)}
                        style={{
                          ...eventStyle(event.color),
                          top: (segment.start / 60) * hourHeight + 1,
                          height: Math.max(height - 2, 16),
                          left: `calc(${placement.left * 100}% + 1px)`,
                          width: `calc(${placement.width * 100}% - ${placement.left + placement.width >= 0.999 ? 8 : 3}px)`,
                        }}
                      >
                        <span className={styles.title}>{event.title || "(No title)"}</span>
                        <span className={styles.meta}>
                          {compact
                            ? formatTime(event.s)
                            : `${timeRange(event.s, event.e)}${event.location ? `, ${event.location}` : ""}`}
                        </span>
                        {showResize ? (
                          <span className={styles.resize} data-resize aria-hidden />
                        ) : null}
                      </div>
                    );
                  })}
                  {drag?.kind === "create-time" && drag.day === index
                    ? (() => {
                        const range = moved
                          ? dragRange(drag.anchor, drag.current, snap)
                          : {
                              start: Math.floor(drag.anchor / snap) * snap,
                              end: Math.floor(drag.anchor / snap) * snap + snap,
                            };
                        return (
                          <div
                            className={styles.selection}
                            style={{
                              top: (range.start / 60) * hourHeight + 1,
                              height: ((range.end - range.start) / 60) * hourHeight - 2,
                              left: 1,
                              right: 8,
                            }}
                          >
                            {timeRange(day + range.start * 60_000, day + range.end * 60_000)}
                          </div>
                        );
                      })()
                    : null}
                  {index === nowDay ? (
                    <div
                      className={styles.now}
                      style={{ top: (minutesInto(day, now) / 60) * hourHeight - 1 }}
                      aria-hidden
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {popoverNode}
    </div>
  );
}
