import { describe, expect, it } from "vitest";

import { agendaMarkdown, feedProblem, feedUrls, linksIn, plainDescription } from "../feeds";
import { parseIcs } from "../ics";
import { occurrencesBetween } from "../recurrence";

const SECRET =
  "https://calendar.google.com/calendar/ical/me%40gmail.com/private-0123abcd/basic.ics";

describe("feeds", () => {
  it("reads several addresses from the setting, fetching webcal over https", () => {
    expect(
      feedUrls(`${SECRET}, webcal://calendar.google.com/calendar/ical/b/basic.ics\n${SECRET}`),
    ).toEqual([SECRET, "https://calendar.google.com/calendar/ical/b/basic.ics"]);
    expect(feedUrls("")).toEqual([]);
    expect(feedUrls(undefined)).toEqual([]);
  });

  it("refuses addresses the plugin may not fetch", () => {
    expect(feedProblem(SECRET)).toBeNull();
    expect(feedProblem("http://calendar.google.com/x.ics")).toMatch(/Only calendar.google.com/);
    expect(feedProblem("https://evil.example/x.ics")).toMatch(/Only calendar.google.com/);
    expect(feedProblem("not a url")).toBe("That isn't a web address.");
  });

  it("writes a day's agenda as a Markdown list", () => {
    const events = parseIcs(
      [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "UID:a",
        "SUMMARY:Holiday",
        "DTSTART;VALUE=DATE:20261018",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:b",
        "SUMMARY:Lunch",
        "LOCATION:Cafe\\nUpstairs",
        "DTSTART:20261018T120000",
        "DTEND:20261018T130000",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
    ).events;
    const day = new Date(2026, 9, 18).getTime();
    const items = occurrencesBetween(events, day, new Date(2026, 9, 19).getTime());
    const markdown = agendaMarkdown("Agenda", items, day);
    expect(markdown).toMatch(/^\*\*Agenda\*\*\n\n- All day Holiday\n- .+ Lunch \(Cafe\)\n$/);
    expect(agendaMarkdown("Agenda", [], day)).toBe("**Agenda**\n\n- No events\n");
  });

  it("turns an HTML description into text and finds its links", () => {
    const text = plainDescription(
      'Join: <a href="https://meet.google.com/abc-defg-hij">https://meet.google.com/abc-defg-hij</a><br>Bring &amp; share',
    );
    expect(text).toBe("Join: https://meet.google.com/abc-defg-hij\nBring & share");
    expect(linksIn(text)).toEqual(["https://meet.google.com/abc-defg-hij"]);
  });
});
