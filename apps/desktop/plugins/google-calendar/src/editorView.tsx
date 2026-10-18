import type { Element } from "@loam/plugin-api";

import type { Target } from "./changes";
import { repeatChoices, type Draft, type RepeatPreset } from "./eventDraft";
import {
  calendarColor,
  calendarName,
  EVENT_COLORS,
  meetLink,
  type GCalendar,
} from "./googleEvents";
import { dayOfIso, isoDay } from "./model";
import {
  localZone,
  parseWall,
  wallClock,
  wallDate,
  wallTime,
  zonedInstant,
  zoneChoices,
} from "./zones";

/*
 * The full event editor, drawn in place of the calendar: title and times, all day, time zone,
 * repeat, Google Meet, location, notifications, calendar, color, busy and visibility,
 * description, and guests.
 */

export type EditorState = {
  target: Target | null;
  draft: Draft;
  before: Draft | null;
  problem: string | null;
};

const REMINDER_CHOICES = [
  { value: "0", label: "At the start" },
  { value: "5", label: "5 minutes before" },
  { value: "10", label: "10 minutes before" },
  { value: "15", label: "15 minutes before" },
  { value: "30", label: "30 minutes before" },
  { value: "60", label: "1 hour before" },
  { value: "120", label: "2 hours before" },
  { value: "1440", label: "1 day before" },
  { value: "2880", label: "2 days before" },
  { value: "10080", label: "1 week before" },
];

const reminderOptions = (minutes: number) =>
  REMINDER_CHOICES.some((choice) => choice.value === String(minutes))
    ? REMINDER_CHOICES
    : [...REMINDER_CHOICES, { value: String(minutes), label: `${minutes} minutes before` }];

/**
 * The draft with one date or time field changed. Changing the start moves the end with it,
 * keeping the length, as Google Calendar does.
 */
export const withTime = (
  draft: Draft,
  field: "startDate" | "startTime" | "endDate" | "endTime",
  value: string,
): Draft => {
  const next = { ...draft, [field]: value };
  if (field === "endDate" || field === "endTime") return next;
  if (draft.allDay) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !/^\d{4}-\d{2}-\d{2}$/.test(draft.startDate))
      return next;
    const length = dayOfIso(draft.endDate) - dayOfIso(draft.startDate);
    return { ...next, endDate: isoDay(dayOfIso(value) + Math.max(0, length)) };
  }
  const start = parseWall(draft.startDate, draft.startTime);
  const end = parseWall(draft.endDate, draft.endTime);
  const moved = parseWall(next.startDate, next.startTime);
  if (!start || !end || !moved) return next;
  const length = zonedInstant(end, draft.zone) - zonedInstant(start, draft.zone);
  const newEnd = wallTime(zonedInstant(moved, draft.zone) + Math.max(0, length), draft.zone);
  return { ...next, endDate: wallDate(newEnd), endTime: wallClock(newEnd) };
};

export const editorView = ({
  state,
  calendars,
  saving,
  set,
  save,
  close,
}: {
  state: EditorState;
  calendars: GCalendar[];
  saving: boolean;
  /** Changes the draft; `redraw` for fields whose change shows elsewhere in the editor. */
  set: (patch: Partial<Draft>, redraw?: boolean) => void;
  save: () => void;
  close: () => void;
}): Element => {
  const { draft, target } = state;
  const calendar = calendars.find((item) => item.id === draft.calendarId);
  const writable = calendars.filter(
    (item) => item.accessRole === "owner" || item.accessRole === "writer",
  );
  const existingMeet = target ? meetLink(target.event) : null;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(draft.startDate) ? dayOfIso(draft.startDate) : 0;
  const reminders = draft.reminders;

  return (
    <Box grow scroll padding={6} gap={4}>
      <Box direction="row" align="center" gap={2}>
        <Button variant="ghost" icon="x" label="Close the editor" onPress={close} />
        <Box grow>
          <Input
            label="Title"
            placeholder="Add title"
            autoFocus
            value={draft.title}
            onChange={(value) => set({ title: value })}
            onSubmit={(value) => {
              set({ title: value });
              save();
            }}
          />
        </Box>
        <Button disabled={saving} onPress={save}>
          Save
        </Button>
      </Box>
      {state.problem ? <Text tone="danger">{state.problem}</Text> : null}

      <Box direction="row" gap={2} wrap align="center">
        <Box width={160}>
          <Input
            type="date"
            label="Start date"
            value={draft.startDate}
            onChange={(value) => set(withTime(draft, "startDate", value), true)}
          />
        </Box>
        {draft.allDay ? null : (
          <Box width={130}>
            <Input
              type="time"
              label="Start time"
              value={draft.startTime}
              onChange={(value) => set(withTime(draft, "startTime", value), true)}
            />
          </Box>
        )}
        <Text tone="muted">to</Text>
        {draft.allDay ? null : (
          <Box width={130}>
            <Input
              type="time"
              label="End time"
              value={draft.endTime}
              onChange={(value) => set({ endTime: value })}
            />
          </Box>
        )}
        <Box width={160}>
          <Input
            type="date"
            label="End date"
            value={draft.endDate}
            onChange={(value) => set({ endDate: value })}
          />
        </Box>
      </Box>

      <Box direction="row" gap={4} wrap align="center">
        <Checkbox
          label="All day"
          checked={draft.allDay}
          onChange={(checked) => set({ allDay: checked }, true)}
        />
        {draft.allDay ? null : (
          <Box width={220}>
            <Select
              label="Time zone"
              value={draft.zone}
              options={zoneChoices(draft.zone, localZone()).map((zone) => ({
                value: zone,
                label: zone.replace(/_/g, " "),
              }))}
              onChange={(zone) => set({ zone }, true)}
            />
          </Box>
        )}
        <Box width={280}>
          <Select
            label="Repeat"
            value={draft.repeat}
            options={repeatChoices(day)}
            onChange={(value) => set({ repeat: value as RepeatPreset }, true)}
          />
        </Box>
      </Box>
      {draft.repeat === "custom" ? (
        <Input
          label="Custom repeat rule"
          placeholder="FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH"
          value={draft.rule}
          onChange={(rule) => set({ rule })}
        />
      ) : null}

      <Divider />

      <Box direction="row" gap={6} wrap align="start">
        <Box grow gap={3}>
          <Box direction="row" gap={2} align="center" wrap>
            <Icon name="play" tone="muted" />
            {existingMeet && draft.meet ? (
              <Link href={existingMeet}>{existingMeet.replace(/^https:\/\//, "")}</Link>
            ) : null}
            <Checkbox
              label={
                existingMeet
                  ? "Google Meet video conferencing"
                  : "Add Google Meet video conferencing"
              }
              checked={draft.meet}
              onChange={(meet) => set({ meet }, true)}
            />
          </Box>
          <Box direction="row" gap={2} align="center">
            <Icon name="map-pin" tone="muted" />
            <Box grow>
              <Input
                label="Location"
                placeholder="Add location"
                value={draft.location}
                onChange={(location) => set({ location })}
              />
            </Box>
          </Box>

          <Box direction="row" gap={2} align="start">
            <Icon name="bell" tone="muted" />
            <Box gap={1} grow>
              {reminders === "default" ? (
                <Box direction="row" gap={2} align="center">
                  <Text size="sm">The calendar's default notifications</Text>
                  <Button
                    variant="ghost"
                    size="sm"
                    onPress={() =>
                      set(
                        {
                          reminders: calendar?.defaultReminders?.map((item) => item.minutes) ?? [
                            30,
                          ],
                        },
                        true,
                      )
                    }
                  >
                    Change
                  </Button>
                </Box>
              ) : (
                reminders.map((minutes, index) => (
                  <Box direction="row" gap={1} align="center">
                    <Box width={200}>
                      <Select
                        label={`Notification ${index + 1}`}
                        value={String(minutes)}
                        options={reminderOptions(minutes)}
                        onChange={(value) =>
                          set(
                            {
                              reminders: reminders.map((item, at) =>
                                at === index ? Number(value) : item,
                              ),
                            },
                            true,
                          )
                        }
                      />
                    </Box>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="x"
                      label={`Remove notification ${index + 1}`}
                      onPress={() =>
                        set({ reminders: reminders.filter((_, at) => at !== index) }, true)
                      }
                    />
                  </Box>
                ))
              )}
              {reminders !== "default" && reminders.length < 5 ? (
                <Box direction="row">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="plus"
                    onPress={() => set({ reminders: [...reminders, 10] }, true)}
                  >
                    Add notification
                  </Button>
                </Box>
              ) : null}
            </Box>
          </Box>

          <Box direction="row" gap={2} align="center">
            <Icon name="calendar" tone="muted" />
            <Box width={260}>
              <Select
                label="Calendar"
                value={draft.calendarId}
                disabled={Boolean(target)}
                options={(target
                  ? calendars.filter((item) => item.id === draft.calendarId)
                  : writable
                ).map((item) => ({ value: item.id, label: calendarName(item).slice(0, 200) }))}
                onChange={(calendarId) => set({ calendarId }, true)}
              />
            </Box>
          </Box>
          <Box direction="row" gap={2} align="center">
            <Icon name="tag" tone="muted" />
            <Box direction="row" gap={1} align="center" wrap>
              <Swatch
                color={calendarColor(calendar)}
                label="Calendar color"
                selected={!draft.colorId}
                onPress={() => set({ colorId: "" }, true)}
              />
              {Object.entries(EVENT_COLORS).map(([id, color]) => (
                <Swatch
                  color={color.hex}
                  label={color.name}
                  selected={draft.colorId === id}
                  onPress={() => set({ colorId: id }, true)}
                />
              ))}
            </Box>
          </Box>

          <Box direction="row" gap={2} align="center" wrap>
            <Icon name="info" tone="muted" />
            <Box width={130}>
              <Select
                label="Show as"
                value={draft.busy ? "busy" : "free"}
                options={[
                  { value: "busy", label: "Busy" },
                  { value: "free", label: "Free" },
                ]}
                onChange={(value) => set({ busy: value === "busy" }, true)}
              />
            </Box>
            <Box width={200}>
              <Select
                label="Visibility"
                value={draft.visibility}
                options={[
                  { value: "default", label: "Default visibility" },
                  { value: "public", label: "Public" },
                  { value: "private", label: "Private" },
                ]}
                onChange={(value) => set({ visibility: value as Draft["visibility"] }, true)}
              />
            </Box>
          </Box>

          <Input
            rows={6}
            label="Description"
            placeholder="Add description"
            value={draft.description}
            onChange={(description) => set({ description })}
          />
        </Box>

        <Box width={300} gap={2}>
          <Text weight="semibold">Guests</Text>
          <Input
            label="Add guests"
            placeholder="Add guests by email"
            clearOnSubmit
            onSubmit={(value) => {
              const emails = value
                .split(/[\s,;]+/)
                .map((email) => email.trim())
                .filter((email) => email && !draft.guests.includes(email));
              if (emails.length) set({ guests: [...draft.guests, ...emails] }, true);
            }}
          />
          {draft.guests.map((email) => {
            const answer = target?.event.attendees?.find(
              (attendee) => attendee.email === email,
            )?.responseStatus;
            return (
              <Box direction="row" align="center" gap={1}>
                <Box grow gap={0}>
                  <Text size="sm" truncate>
                    {email}
                  </Text>
                  {answer && answer !== "needsAction" ? (
                    <Text size="xs" tone="muted">
                      {answer === "accepted"
                        ? "Going"
                        : answer === "declined"
                          ? "Not going"
                          : "Maybe"}
                    </Text>
                  ) : null}
                </Box>
                <Button
                  variant="ghost"
                  size="sm"
                  icon="x"
                  label={`Remove ${email}`}
                  onPress={() =>
                    set({ guests: draft.guests.filter((item) => item !== email) }, true)
                  }
                />
              </Box>
            );
          })}
          {draft.guests.length ? null : (
            <Text size="xs" tone="muted">
              Guests get an invitation email if you choose to send one when you save.
            </Text>
          )}
        </Box>
      </Box>
    </Box>
  );
};
