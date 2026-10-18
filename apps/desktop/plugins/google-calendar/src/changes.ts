import { GoogleApiError, type GoogleApi } from "./googleApi";
import { instantOf, type GDate, type GEvent } from "./googleEvents";
import { isFirstInstance, type RecurringScope } from "./recurrenceEdit";
import { deleteRecurring, saveRecurring } from "./recurringChanges";
import type { SyncEngine } from "./sync";

/*
 * Every change the user makes to their calendars. Each shows at once (the kept events change
 * before Google answers) and is rolled back if Google refuses it. A change to an event someone
 * else changed meanwhile (412) asks whether to reload theirs or overwrite it. The last move,
 * resize, edit, creation or deletion of a single event can be undone.
 */

export type Target = { calendarId: string; event: GEvent };

type Choice = { value: string; label: string; tone?: "danger" };

export type ChangeDeps = {
  api: GoogleApi;
  engine: Pick<SyncEngine, "get" | "put" | "events">;
  /** Asks in a dialog; resolves with the value picked, or null if dismissed. */
  ask: (question: {
    title: string;
    description?: string;
    choices: Choice[];
  }) => Promise<string | null>;
  /** Tells the user; `undo` adds an Undo button. */
  notify: (
    text: string,
    options?: { tone?: "success" | "error" | "info"; undo?: () => void },
  ) => void;
  /** Draws the view again with the kept events. */
  redraw: () => void;
  /** Syncs a calendar again, after a change to a whole series. */
  resync: (calendarId: string) => Promise<void>;
};

/**
 * A change the user called off in a dialog: nothing to report. `fresh` is the event as Google
 * has it now, when the user chose to reload it.
 */
class Cancelled extends Error {
  constructor(readonly fresh?: GEvent | null) {
    super("Cancelled");
  }
}

type SendUpdates = "all" | "none" | undefined;

const PENDING_PREFIX = "loam-pending-";

/** A start or end with every field named, so a patch clears the ones it no longer uses. */
const fullTime = (time: GDate | undefined): GDate => ({
  date: time?.date ?? null,
  dateTime: time?.dateTime ?? null,
  timeZone: time?.timeZone ?? null,
});

/** An event with a patch applied, as Google will keep it: nulls remove fields. */
const patched = (event: GEvent, patch: Partial<GEvent>): GEvent => {
  const out: Record<string, unknown> = { ...event };
  for (const [field, value] of Object.entries(patch)) {
    if (value === null) delete out[field];
    else if (field === "start" || field === "end")
      out[field] = Object.fromEntries(
        Object.entries(value as GDate).filter(([, item]) => item !== null && item !== undefined),
      );
    else if (field !== "conferenceData") out[field] = value;
  }
  return out as GEvent;
};

/** The patch that puts back what `patch` changed. */
const inverseOf = (event: GEvent, patch: Partial<GEvent>): Partial<GEvent> => {
  const inverse: Record<string, unknown> = {};
  for (const field of Object.keys(patch)) {
    if (field === "conferenceData") continue;
    const value = (event as Record<string, unknown>)[field];
    inverse[field] =
      field === "start" || field === "end" ? fullTime(value as GDate | undefined) : (value ?? null);
  }
  return inverse as Partial<GEvent>;
};

const hasOtherGuests = (event: Partial<GEvent>) =>
  (event.attendees ?? []).some((attendee) => !attendee.self && !attendee.resource);

const errorText = (error: unknown) => {
  if (error instanceof GoogleApiError) {
    if (error.status === 403) return "Google Calendar didn't allow that change.";
    if (error.status === 404 || error.status === 410)
      return "That event is no longer in Google Calendar.";
    return `Google Calendar couldn't save it: ${error.message}`;
  }
  const message = error instanceof Error ? error.message : String(error);
  return message || "Google Calendar couldn't be reached.";
};

export const createChanges = ({ api, engine, ask, notify, redraw, resync }: ChangeDeps) => {
  let undoable: { run: () => Promise<void> } | null = null;
  let pending = 0;

  /** Runs a write that names the version it changes; on 412, asks to reload or overwrite. */
  const withConflict = async <T>(target: Target, run: (etag: string | undefined) => Promise<T>) => {
    try {
      return await run(target.event.etag);
    } catch (error) {
      if (!(error instanceof GoogleApiError) || error.status !== 412) throw error;
      const answer = await ask({
        title: "This event changed in Google Calendar",
        description:
          "It was changed somewhere else since Loam last synced. Reload to see that version, or overwrite it with your change.",
        choices: [
          { value: "reload", label: "Reload" },
          { value: "overwrite", label: "Overwrite", tone: "danger" },
        ],
      });
      if (answer === "overwrite") return run(undefined);
      const fresh = await api.get(target.calendarId, target.event.id).catch(() => null);
      throw new Cancelled(fresh);
    }
  };

  /** Shows `optimistic` in place of the event at once, then runs the write; undoes the show on failure. */
  const write = async <T>(
    target: Target,
    optimistic: GEvent | null,
    run: () => Promise<T>,
  ): Promise<T | null> => {
    const before = engine.get(target.calendarId, target.event.id);
    engine.put(target.calendarId, target.event.id, optimistic);
    redraw();
    try {
      return await run();
    } catch (error) {
      engine.put(
        target.calendarId,
        target.event.id,
        error instanceof Cancelled && error.fresh !== undefined ? error.fresh : before,
      );
      redraw();
      if (!(error instanceof Cancelled)) notify(errorText(error), { tone: "error" });
      return null;
    }
  };

  const offerUndo = (text: string, run: (() => Promise<void>) | null) => {
    undoable = run ? { run } : null;
    notify(text, { tone: "success", ...(run && { undo: () => void undo() }) });
  };

  /** For a recurring event, which instances a change is for; null if the user called it off. */
  const askScope = async (
    target: Target,
    verb: "edit" | "delete",
    { allowThis = true }: { allowThis?: boolean } = {},
  ): Promise<RecurringScope | "single" | null> => {
    if (!target.event.recurringEventId) return "single";
    const master = await api.get(target.calendarId, target.event.recurringEventId);
    const first = isFirstInstance(master, target.event);
    const answer = await ask({
      title: verb === "delete" ? "Delete recurring event" : "Edit recurring event",
      choices: [
        ...(allowThis ? [{ value: "this", label: "This event" }] : []),
        ...(first ? [] : [{ value: "following", label: "This and following events" }]),
        {
          value: "all",
          label: "All events",
          ...(verb === "delete" && { tone: "danger" as const }),
        },
      ],
    });
    return answer === "this" || answer === "following" || answer === "all" ? answer : null;
  };

  /** Whether to email the guests, if the event has any; null if the user called it off. */
  const askSendUpdates = async (
    event: Partial<GEvent>,
    kind: "new" | "edit" | "delete",
  ): Promise<SendUpdates | null> => {
    if (!hasOtherGuests(event)) return undefined;
    const answer = await ask({
      title:
        kind === "new"
          ? "Send invitation emails to the guests?"
          : kind === "delete"
            ? "Let the guests know it's cancelled?"
            : "Send update emails to the guests?",
      choices: [
        { value: "all", label: "Send" },
        { value: "none", label: "Don't send" },
      ],
    });
    return answer === "all" || answer === "none" ? answer : null;
  };

  /** Removes the instances a series change replaces, until the sync brings the new ones. */
  const dropSeries = (target: Target, scope: "following" | "all") => {
    const pivot = instantOf(target.event.originalStartTime ?? target.event.start);
    for (const event of engine.events(target.calendarId))
      if (
        event.recurringEventId === target.event.recurringEventId &&
        (scope === "all" || instantOf(event.originalStartTime ?? event.start) >= pivot)
      )
        engine.put(target.calendarId, event.id, null);
  };

  /**
   * Saves a change to an existing event: a drag, a resize or the editor's fields. A recurring
   * event asks which instances it is for; an event with guests asks whether to email them.
   */
  const update = async (
    target: Target,
    patch: Partial<GEvent>,
    {
      label = "Event saved",
      conference = false,
      guestsChanged = false,
    }: { label?: string; conference?: boolean; guestsChanged?: boolean } = {},
  ) => {
    const changesRule = patch.recurrence !== undefined;
    const scope = await askScope(target, "edit", { allowThis: !changesRule });
    if (!scope) return redraw();
    const sendUpdates = await askSendUpdates(
      guestsChanged ? { ...target.event, ...patch } : target.event,
      "edit",
    );
    if (sendUpdates === null) return redraw();
    const options = {
      ...(sendUpdates && { sendUpdates }),
      ...(conference && { conferenceDataVersion: 1 as const }),
    };
    const optimistic = patched(target.event, patch);

    if (scope === "single" || scope === "this") {
      const saved = await write(target, optimistic, () =>
        withConflict(target, (etag) =>
          api.patch(target.calendarId, target.event.id, patch, { ...options, etag }),
        ),
      );
      if (!saved) return;
      engine.put(target.calendarId, target.event.id, saved);
      redraw();
      const inverse = inverseOf(target.event, patch);
      offerUndo(label, async () => {
        const back = await api.patch(target.calendarId, saved.id, inverse, {
          ...(sendUpdates && { sendUpdates }),
        });
        engine.put(target.calendarId, saved.id, back);
      });
      if (scope === "single" && (changesRule || saved.recurrence?.length))
        await resync(target.calendarId);
      return;
    }

    const saved = await write(target, optimistic, () =>
      saveRecurring(api, {
        calendarId: target.calendarId,
        instance: target.event,
        patch,
        scope,
        options,
      }),
    );
    if (!saved) return;
    dropSeries(target, scope);
    redraw();
    offerUndo(label, null);
    await resync(target.calendarId);
  };

  /** Moves or resizes an event to grid times already in Google's shape. */
  const move = (target: Target, start: GDate, end: GDate, label: string) =>
    update(target, { start: fullTime(start), end: fullTime(end) }, { label });

  /** Makes an event; resolves with it as Google saved it, or null. */
  const create = async (calendarId: string, body: Partial<GEvent>, { conference = false } = {}) => {
    const sendUpdates = await askSendUpdates(body, "new");
    if (sendUpdates === null) return null;
    const temp = `${PENDING_PREFIX}${(pending += 1)}`;
    const target = { calendarId, event: { id: temp } as GEvent };
    const optimistic = patched(
      { id: temp, status: "confirmed", organizer: { self: true } } as GEvent,
      body,
    );
    const saved = await write(target, optimistic, () =>
      api.insert(calendarId, body, {
        ...(sendUpdates && { sendUpdates }),
        ...(conference && { conferenceDataVersion: 1 as const }),
      }),
    );
    if (!saved) return null;
    engine.put(calendarId, temp, null);
    engine.put(calendarId, saved.id, saved);
    redraw();
    offerUndo("Event created", async () => {
      await api.remove(calendarId, saved.id, { ...(sendUpdates && { sendUpdates }) });
      engine.put(calendarId, saved.id, null);
      if (saved.recurrence?.length) await resync(calendarId);
    });
    if (saved.recurrence?.length) await resync(calendarId);
    return saved;
  };

  /** Deletes an event; a recurring one asks which instances, which is its confirmation too. */
  const remove = async (target: Target) => {
    const scope = await askScope(target, "delete");
    if (!scope) return;
    const sendUpdates = await askSendUpdates(target.event, "delete");
    if (sendUpdates === null) return;
    const options = sendUpdates ? { sendUpdates } : {};
    if (scope === "single" || scope === "this") {
      const done = await write(target, null, () =>
        withConflict(target, async (etag) => {
          await api.remove(target.calendarId, target.event.id, { ...options, etag });
          return true;
        }),
      );
      if (!done) return;
      // A deleted event (or instance) is only cancelled in Google, and comes back confirmed.
      offerUndo("Event deleted", async () => {
        const back = await api.patch(
          target.calendarId,
          target.event.id,
          { status: "confirmed" },
          options,
        );
        engine.put(target.calendarId, target.event.id, back);
      });
      return;
    }
    const done = await write(target, null, async () => {
      await deleteRecurring(api, {
        calendarId: target.calendarId,
        instance: target.event,
        scope,
        options,
      });
      return true;
    });
    if (!done) return;
    dropSeries(target, scope);
    redraw();
    offerUndo(scope === "all" ? "Series deleted" : "Events deleted", null);
    await resync(target.calendarId);
  };

  /** Answers an invitation for this instance: yes, no or maybe. */
  const respond = async (target: Target, status: "accepted" | "declined" | "tentative") => {
    const attendees = (target.event.attendees ?? []).map((attendee) =>
      attendee.self ? { ...attendee, responseStatus: status } : attendee,
    );
    const saved = await write(target, { ...target.event, attendees }, () =>
      api.patch(target.calendarId, target.event.id, { attendees }),
    );
    if (saved) engine.put(target.calendarId, target.event.id, saved);
    redraw();
  };

  async function undo() {
    const last = undoable;
    undoable = null;
    if (!last) return;
    try {
      await last.run();
      notify("Undone", { tone: "info" });
    } catch (error) {
      notify(errorText(error), { tone: "error" });
    }
    redraw();
  }

  return { update, move, create, remove, respond, undo, canUndo: () => undoable !== null };
};

export type Changes = ReturnType<typeof createChanges>;
