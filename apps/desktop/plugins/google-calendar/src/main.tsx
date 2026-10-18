import type { Api, Element, Register } from "@loam/plugin-api";

import { civilDate, dayNumber, localDay, localMidnight, weekdayOf } from "./dates";
import {
  agendaMarkdown,
  feedProblem,
  feedUrls,
  linksIn,
  plainDescription,
  timeRange,
} from "./feeds";
import { parseIcs, type IcsEvent } from "./ics";
import { occurrencesBetween, type Occurrence } from "./recurrence";

/*
 * Google Calendar, read-only, from each calendar's secret address in iCal format: an agenda of
 * today and the days ahead, a week and a month, and today's agenda in the slash menu.
 */

type View = "agenda" | "week" | "month";
type Feed = { url: string; name: string; events: IcsEvent[]; error: string | null };

const PANE = "calendar";
const UPCOMING_DAYS = 14;
const MAX_AGENDA_ITEMS = 80;
const STALE_MS = 15 * 60_000;
const SLASH_WAIT_MS = 4_000;

const formatDay = (day: number, options: Intl.DateTimeFormatOptions) =>
  new Date(localMidnight(day)).toLocaleDateString([], options);

export const register: Register = (on, options) => {
  const urls = feedUrls(options.urls);
  const weekStart = options.weekStart === "sunday" ? 0 : 1;

  let feeds: Feed[] = [];
  let loadedAt = 0;
  let loading: Promise<void> | null = null;
  const calendarOf = new WeakMap<IcsEvent, string>();

  const refresh = ($: Api) => {
    loading ??= (async () => {
      await $.ui.invalidate();
      feeds = await Promise.all(
        urls.map(async (url): Promise<Feed> => {
          const problem = feedProblem(url);
          if (problem) return { url, name: "", events: [], error: problem };
          try {
            const response = await $.net.fetch(url, { headers: { Accept: "text/calendar" } });
            if (response.status !== 200)
              return {
                url,
                name: "",
                events: [],
                error: `Google Calendar answered ${response.status}. Check the address.`,
              };
            const calendar = parseIcs(response.body);
            for (const event of calendar.events) calendarOf.set(event, calendar.name);
            return { url, name: calendar.name, events: calendar.events, error: null };
          } catch {
            return { url, name: "", events: [], error: "Google Calendar could not be reached." };
          }
        }),
      );
      loadedAt = Date.now();
      loading = null;
      await $.ui.invalidate();
    })();
    return loading;
  };

  const ensureFresh = ($: Api) => {
    if (urls.length && !loading && Date.now() - loadedAt > STALE_MS) void refresh($);
  };

  const allEvents = () => feeds.flatMap((feed) => feed.events);

  /** Each day's occurrences from `firstDay`, for `days` days; a long event is on every day it spans. */
  const byDay = (firstDay: number, days: number) => {
    const from = localMidnight(firstDay);
    const to = localMidnight(firstDay + days);
    const buckets: Occurrence[][] = Array.from({ length: days }, () => []);
    for (const item of occurrencesBetween(allEvents(), from, to)) {
      const first = Math.max(firstDay, localDay(item.start));
      const last = Math.min(
        firstDay + days - 1,
        localDay(item.end > item.start ? item.end - 1 : item.start),
      );
      for (let day = first; day <= last; day += 1) buckets[day - firstDay]!.push(item);
    }
    return buckets;
  };

  const open = ($: Api) => $.ui.open({ id: PANE, title: "Calendar" });

  const keyOf = (item: Occurrence) => `${item.event.uid}|${item.start}`;

  const details = (item: Occurrence, day: number): Element => {
    const description = plainDescription(item.event.description);
    const links = [...new Set([item.event.url, ...linksIn(description)].filter(Boolean))].filter(
      (url) => /^https?:\/\//.test(url),
    );
    const calendar = calendarOf.get(item.event);
    return (
      <Box surface padding={2} gap={1}>
        <Heading level={3}>{item.event.summary || "(No title)"}</Heading>
        <Text size="xs" tone="muted">
          {`${formatDay(day, { weekday: "long", month: "long", day: "numeric" })}, ${timeRange(item, localMidnight(day))}`}
        </Text>
        {item.event.location ? (
          <Box direction="row" gap={1} align="center">
            <Icon name="map-pin" />
            <Text size="xs">{item.event.location}</Text>
          </Box>
        ) : null}
        {description
          ? description
              .split("\n")
              .slice(0, 40)
              .map((line) => <Text size="xs">{line || "\u00a0"}</Text>)
          : null}
        {links.slice(0, 5).map((url) => (
          <Link href={url}>{url}</Link>
        ))}
        {calendar && feeds.length > 1 ? <Badge tone="muted">{calendar}</Badge> : null}
      </Box>
    );
  };

  const eventList = ($: Api, items: Occurrence[], day: number, selected: string | null) =>
    items.map((item) => {
      const key = keyOf(item);
      const time = timeRange(item, localMidnight(day));
      const title = item.event.summary || "(No title)";
      return (
        <Box gap={1}>
          <Box
            padding={1}
            gap={0}
            label={`${title}, ${time}`}
            onPress={() =>
              $.state.set("selected", selected === `${day}|${key}` ? null : `${day}|${key}`)
            }
          >
            <Text truncate weight="medium">
              {title}
            </Text>
            <Text size="xs" tone="muted" truncate>
              {item.event.location ? `${time} · ${item.event.location.split("\n")[0]}` : time}
            </Text>
          </Box>
          {selected === `${day}|${key}` ? details(item, day) : null}
        </Box>
      );
    });

  const dayHeading = (day: number, today: number) => (
    <Box direction="row" gap={2} align="center">
      <Heading level={3}>
        {formatDay(day, { weekday: "short", month: "short", day: "numeric" })}
      </Heading>
      {day === today ? <Badge tone="accent">Today</Badge> : null}
    </Box>
  );

  const agenda = ($: Api, today: number, selected: string | null) => {
    const buckets = byDay(today, UPCOMING_DAYS + 1);
    let shown = 0;
    const upcoming = buckets.slice(1).flatMap((items, index) => {
      if (!items.length || shown >= MAX_AGENDA_ITEMS) return [];
      shown += items.length;
      const day = today + 1 + index;
      return [
        <Box gap={1}>
          {dayHeading(day, today)}
          {eventList($, items, day, selected)}
        </Box>,
      ];
    });
    return (
      <Box gap={3}>
        <Box gap={1}>
          {dayHeading(today, today)}
          {buckets[0]!.length ? (
            eventList($, buckets[0]!, today, selected)
          ) : (
            <Text tone="muted">Nothing today.</Text>
          )}
        </Box>
        <Divider />
        <Text size="xs" tone="muted" weight="semibold">
          Upcoming
        </Text>
        {upcoming.length ? upcoming : <Text tone="muted">Nothing in the next two weeks.</Text>}
      </Box>
    );
  };

  const navigation = ($: Api, label: string, step: (direction: number) => number) => (
    <Box direction="row" gap={1} align="center">
      <Button
        variant="ghost"
        icon="chevron-left"
        label="Previous"
        onPress={() => $.state.set("cursor", step(-1))}
      />
      <Button variant="outline" onPress={() => $.state.set("cursor", null)}>
        Today
      </Button>
      <Button
        variant="ghost"
        icon="chevron-right"
        label="Next"
        onPress={() => $.state.set("cursor", step(1))}
      />
      <Box grow align="end">
        <Text weight="semibold" truncate>
          {label}
        </Text>
      </Box>
    </Box>
  );

  const week = ($: Api, today: number, cursor: number, selected: string | null) => {
    const first = cursor - ((weekdayOf(cursor) - weekStart + 7) % 7);
    const buckets = byDay(first, 7);
    const label = `${formatDay(first, { month: "short", day: "numeric" })} – ${formatDay(first + 6, { month: "short", day: "numeric", year: "numeric" })}`;
    return (
      <Box gap={3}>
        {navigation($, label, (direction) => cursor + direction * 7)}
        {buckets.map((items, index) => (
          <Box gap={1}>
            {dayHeading(first + index, today)}
            {items.length ? (
              eventList($, items, first + index, selected)
            ) : (
              <Text size="xs" tone="muted">
                No events
              </Text>
            )}
          </Box>
        ))}
      </Box>
    );
  };

  const month = (
    $: Api,
    today: number,
    cursor: number,
    picked: number | null,
    selected: string | null,
  ) => {
    const { y, m } = civilDate(cursor);
    const monthStart = dayNumber(y, m, 1);
    const nextMonth = m === 12 ? dayNumber(y + 1, 1, 1) : dayNumber(y, m + 1, 1);
    const first = monthStart - ((weekdayOf(monthStart) - weekStart + 7) % 7);
    const weeks = Math.ceil((nextMonth - first) / 7);
    const buckets = byDay(first, weeks * 7);
    const day =
      picked !== null && picked >= monthStart && picked < nextMonth
        ? picked
        : today >= monthStart && today < nextMonth
          ? today
          : monthStart;
    const step = (direction: number) => {
      const months = m - 1 + direction;
      return dayNumber(y + Math.floor(months / 12), (((months % 12) + 12) % 12) + 1, 1);
    };
    return (
      <Box gap={3}>
        {navigation($, formatDay(monthStart, { month: "long", year: "numeric" }), step)}
        <Box gap={1}>
          <Box columns={7}>
            {Array.from({ length: 7 }, (_, index) => (
              <Box align="center">
                <Text size="xs" tone="muted">
                  {formatDay(first + index, { weekday: "narrow" })}
                </Text>
              </Box>
            ))}
          </Box>
          <Box columns={7} gap={0}>
            {buckets.map((items, index) => {
              const cell = first + index;
              const inMonth = cell >= monthStart && cell < nextMonth;
              const count = items.length;
              return (
                <Box
                  align="center"
                  padding={1}
                  gap={0}
                  surface={cell === day}
                  label={`${formatDay(cell, { month: "long", day: "numeric" })}, ${count === 1 ? "1 event" : `${count} events`}`}
                  onPress={() => $.state.set("day", cell)}
                >
                  <Text
                    size="xs"
                    weight={cell === today ? "semibold" : "normal"}
                    tone={cell === today ? "accent" : inMonth ? "default" : "muted"}
                  >
                    {String(civilDate(cell).d)}
                  </Text>
                  <Text size="xs" tone="accent">
                    {count ? "•" : "\u00a0"}
                  </Text>
                </Box>
              );
            })}
          </Box>
        </Box>
        <Box gap={1}>
          {dayHeading(day, today)}
          {buckets[day - first]!.length ? (
            eventList($, buckets[day - first]!, day, selected)
          ) : (
            <Text size="xs" tone="muted">
              No events
            </Text>
          )}
        </Box>
      </Box>
    );
  };

  on("app.ready", async ($) => {
    await $.commands.register({ id: "open", title: "Open calendar" });
    await $.editor.registerSlashItem({
      id: "agenda",
      title: "Today's agenda",
      subtext: "Insert today's events from Google Calendar.",
      aliases: ["agenda", "calendar", "events"],
    });
  });

  on("command.run", { command: "open" }, async ($) => {
    await open($);
    ensureFresh($);
  });

  on("ui.render", { slot: "sidebar.footer" }, async ($) => (
    <Button variant="ghost" icon="calendar" label="Calendar" onPress={() => open($)} />
  ));

  on("ui.render", { slot: "pane", props: { pane: PANE } }, async ($) => {
    ensureFresh($);
    const view = ((await $.state.get<View>("view")) ?? "agenda") as View;
    const today = localDay(Date.now());
    const cursor = (await $.state.get<number>("cursor")) ?? today;
    const selected = await $.state.get<string>("selected");
    const picked = await $.state.get<number>("day");
    const errors = feeds.filter((feed) => feed.error);

    return (
      <Box gap={3}>
        <Box direction="row" gap={2} align="center" justify="between">
          <Select
            label="View"
            value={view}
            options={[
              { value: "agenda", label: "Today & upcoming" },
              { value: "week", label: "Week" },
              { value: "month", label: "Month" },
            ]}
            onChange={async (value) => {
              await $.state.set("selected", null);
              await $.state.set("view", value);
            }}
          />
          <Box direction="row" gap={1} align="center">
            {loading ? (
              <Text size="xs" tone="muted">
                Updating…
              </Text>
            ) : null}
            <Button
              variant="ghost"
              icon="refresh"
              label={
                loadedAt
                  ? `Refresh (updated ${new Date(loadedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})`
                  : "Refresh"
              }
              disabled={!urls.length || loading !== null}
              onPress={() => refresh($)}
            />
          </Box>
        </Box>
        {urls.length === 0 ? (
          <Box surface padding={3} gap={2}>
            <Text weight="medium">Connect a calendar</Text>
            <Text size="xs" tone="muted">
              In Google Calendar, open Settings, pick a calendar and copy its "Secret address in
              iCal format". Paste it in Loam's Settings, under Plugins, Google Calendar.
            </Text>
          </Box>
        ) : null}
        {errors.map((feed) => (
          <Text size="xs" tone="danger">
            {feeds.length > 1 ? `${feed.name || "A calendar"}: ${feed.error}` : feed.error}
          </Text>
        ))}
        {view === "week"
          ? week($, today, cursor, selected)
          : view === "month"
            ? month($, today, cursor, picked, selected)
            : agenda($, today, selected)}
      </Box>
    );
  });

  on("slash.run", { item: "agenda" }, async ($) => {
    if (urls.length && Date.now() - loadedAt > STALE_MS)
      await Promise.race([refresh($), new Promise((done) => setTimeout(done, SLASH_WAIT_MS))]);
    const today = localDay(Date.now());
    const title = `Agenda for ${formatDay(today, { weekday: "long", month: "long", day: "numeric" })}`;
    return { markdown: agendaMarkdown(title, byDay(today, 1)[0]!, localMidnight(today)) };
  });
};
