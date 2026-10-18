import { GoogleApiError, type GoogleApi } from "./googleApi";
import { instantOf, type GEvent } from "./googleEvents";
import {
  carriedFrom,
  copiedFields,
  endedBefore,
  instancesBefore,
  isFirstInstance,
  seriesMovedLike,
  shiftWeekdays,
  wallShift,
  type RecurringScope,
} from "./recurrenceEdit";
import { localZone } from "./zones";

/*
 * Saving and deleting one instance of a recurring event, the instances from it on, or the
 * whole series, with the Calendar API.
 */

type Options = { sendUpdates?: "all" | "none"; conferenceDataVersion?: 0 | 1 };

const gone = (error: unknown) =>
  error instanceof GoogleApiError && (error.status === 404 || error.status === 410);

/** The series' exceptions from the pivot on, which the series ending before it leaves behind. */
const exceptionsFrom = async (api: GoogleApi, calendarId: string, master: GEvent, pivot: number) =>
  (await api.exceptions(calendarId, master)).filter(
    (exception) => instantOf(exception.originalStartTime ?? exception.start) >= pivot,
  );

const removeAll = async (api: GoogleApi, calendarId: string, events: GEvent[]) => {
  for (const event of events)
    await api.remove(calendarId, event.id, { sendUpdates: "none" }).catch((error: unknown) => {
      if (!gone(error)) throw error;
    });
};

/**
 * Saves `patch` (any event fields, start and end included) to an instance of a recurring
 * event, in `scope`. Resolves with the events Google saved.
 */
export const saveRecurring = async (
  api: GoogleApi,
  {
    calendarId,
    instance,
    patch,
    scope: asked,
    options = {},
  }: {
    calendarId: string;
    instance: GEvent;
    patch: Partial<GEvent>;
    scope: RecurringScope;
    options?: Options;
  },
): Promise<GEvent[]> => {
  if (asked === "this")
    return [await api.patch(calendarId, instance.id, patch, { ...options, etag: instance.etag })];
  const master = await api.get(calendarId, instance.recurringEventId!);
  const scope = asked === "following" && isFirstInstance(master, instance) ? "all" : asked;
  const moved = Boolean(patch.start || patch.end);
  const to = { start: patch.start ?? instance.start!, end: patch.end ?? instance.end! };

  if (scope === "all") {
    const times = moved ? seriesMovedLike(master, { start: instance.start! }, to) : {};
    const body: Partial<GEvent> = {
      ...patch,
      ...times,
      ...(patch.recurrence && { recurrence: patch.recurrence }),
    };
    return [await api.patch(calendarId, master.id, body, { ...options, etag: master.etag })];
  }

  // This and following: end the series before the instance, and start a new one there.
  const pivot = instance.originalStartTime ?? instance.start!;
  const before = instancesBefore(master, pivot);
  const exceptions = await exceptionsFrom(api, calendarId, master, instantOf(pivot));
  const zone = master.start?.timeZone ?? localZone();
  const days = moved ? wallShift(instance.start!, to.start, zone).days : 0;
  const ended = await api.patch(
    calendarId,
    master.id,
    { recurrence: endedBefore(master, pivot) },
    { sendUpdates: options.sendUpdates, etag: master.etag },
  );
  await removeAll(api, calendarId, exceptions);
  const next = await api.insert(
    calendarId,
    {
      ...copiedFields(master),
      start: instance.start,
      end: instance.end,
      recurrence: shiftWeekdays(carriedFrom(master, pivot, before), days),
      ...patch,
    },
    options,
  );
  return [ended, next];
};

/** Deletes an instance of a recurring event, the instances from it on, or the whole series. */
export const deleteRecurring = async (
  api: GoogleApi,
  {
    calendarId,
    instance,
    scope: asked,
    options = {},
  }: {
    calendarId: string;
    instance: GEvent;
    scope: RecurringScope;
    options?: Pick<Options, "sendUpdates">;
  },
) => {
  if (asked === "this") {
    await api.remove(calendarId, instance.id, { ...options, etag: instance.etag });
    return;
  }
  const master = await api.get(calendarId, instance.recurringEventId!);
  if (asked === "all" || isFirstInstance(master, instance)) {
    await api.remove(calendarId, master.id, { ...options, etag: master.etag });
    return;
  }
  const pivot = instance.originalStartTime ?? instance.start!;
  const exceptions = await exceptionsFrom(api, calendarId, master, instantOf(pivot));
  await api.patch(
    calendarId,
    master.id,
    { recurrence: endedBefore(master, pivot) },
    { ...options, etag: master.etag },
  );
  await removeAll(api, calendarId, exceptions);
};
