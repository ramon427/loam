import type { Occurrence } from "./recurrence";

/** The host the manifest is granted; any other address is refused before it is fetched. */
const CALENDAR_HOST = "calendar.google.com";

/**
 * The feed addresses in the setting, separated by spaces, commas or new lines. A webcal://
 * address is fetched over https, as Google serves it.
 */
export const feedUrls = (setting: unknown) =>
  typeof setting === "string"
    ? [
        ...new Set(
          setting
            .split(/[\s,]+/)
            .map((url) => url.trim().replace(/^webcal:\/\//i, "https://"))
            .filter(Boolean),
        ),
      ]
    : [];

/** Why an address can't be fetched, or null when it can. */
export const feedProblem = (url: string) => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "That isn't a web address.";
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== CALENDAR_HOST)
    return `Only ${CALENDAR_HOST} addresses can be read.`;
  return null;
};

const time = (instant: number) =>
  new Date(instant).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** "09:00–09:30", "All day", or "from 22:00" for an event that began the day before. */
export const timeRange = (item: Occurrence, dayStart: number) => {
  if (item.allDay) return "All day";
  if (item.start === item.end) return time(item.start);
  const startLabel = item.start < dayStart ? "…" : time(item.start);
  return `${startLabel}–${time(item.end)}`;
};

/** A day's occurrences as a Markdown list, for the slash menu. */
export const agendaMarkdown = (title: string, items: Occurrence[], dayStart: number) => {
  const lines = items.map((item) => {
    const location = item.event.location ? ` (${item.event.location.split("\n")[0]})` : "";
    return `- ${timeRange(item, dayStart)} ${item.event.summary || "(No title)"}${location}`;
  });
  return `**${title}**\n\n${lines.length ? lines.join("\n") : "- No events"}\n`;
};

/** Plain text from a description, which Google sometimes fills with simple HTML. */
export const plainDescription = (description: string) =>
  description
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** The web addresses a description mentions, so they can be opened. */
export const linksIn = (text: string) => [...new Set(text.match(/https:\/\/[^\s<>"')\]]+/g) ?? [])];
