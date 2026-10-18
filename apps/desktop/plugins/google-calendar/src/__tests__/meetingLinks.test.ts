import { describe, expect, it } from "vitest";

import { joinLinkIn } from "../meetingLinks";

const TEAMS =
  "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%22Tid%22%3a%22t%22%7d";

describe("joinLinkIn", () => {
  it("finds a Teams link in Outlook's join text, without the brackets around it", () => {
    expect(
      joinLinkIn(`Microsoft Teams meeting\nClick here to join the meeting<${TEAMS}>\nMeeting ID`),
    ).toEqual({ kind: "teams", url: TEAMS, label: "Join Teams meeting" });
  });

  it("knows Teams' newer and personal links, Meet and Zoom", () => {
    expect(joinLinkIn("https://teams.microsoft.com/meet/27612345678901?p=QwErTy")?.kind).toBe(
      "teams",
    );
    expect(joinLinkIn("Join: https://teams.live.com/meet/9876543210?p=abc.")?.url).toBe(
      "https://teams.live.com/meet/9876543210?p=abc",
    );
    expect(joinLinkIn("Video call: https://meet.google.com/abc-defg-hij")).toEqual({
      kind: "meet",
      url: "https://meet.google.com/abc-defg-hij",
      label: "Join with Google Meet",
    });
    expect(joinLinkIn("https://contoso.zoom.us/j/91234567890?pwd=x")).toMatchObject({
      kind: "zoom",
      label: "Join Zoom meeting",
    });
  });

  it("unwraps Outlook's Safe Links", () => {
    const wrapped = `https://nam12.safelinks.protection.outlook.com/?url=${encodeURIComponent(TEAMS)}&data=05`;
    expect(joinLinkIn(wrapped)?.url).toBe(TEAMS);
  });

  it("skips other links, SIP addresses and lookalike hosts, reading the texts in order", () => {
    expect(joinLinkIn("https://teams.microsoft.com/meetingOptions/?organizerId=1")).toBeNull();
    expect(joinLinkIn("conf:sip:alex@contoso.example;gruu")).toBeNull();
    expect(joinLinkIn("https://teams.microsoft.com.evil.example/l/meetup-join/1")).toBeNull();
    expect(joinLinkIn("http://meet.google.com/abc-defg-hij")).toBeNull();
    expect(
      joinLinkIn(null, "", "Room 4", `x ${TEAMS}`, "https://meet.google.com/abc-defg-hij"),
    ).toMatchObject({ kind: "teams" });
  });
});
