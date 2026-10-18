/*
 * The video call an event's details point to: a Microsoft Teams, Google Meet or Zoom link,
 * found in the fields a calendar keeps it in or written into the location or description.
 */

export type JoinLink = { kind: "teams" | "meet" | "zoom"; url: string; label: string };

const KINDS: { kind: JoinLink["kind"]; label: string; host: RegExp; path: RegExp }[] = [
  {
    kind: "teams",
    label: "Join Teams meeting",
    host: /^teams\.(?:microsoft\.com|microsoft\.us|live\.com)$/,
    path: /^\/(?:l\/meetup-join\/|meet\/|v2\/\?meetingjoin=)/,
  },
  {
    kind: "meet",
    label: "Join with Google Meet",
    host: /^meet\.google\.com$/,
    path: /^\/[a-z]{3,4}-[a-z]{3,4}-[a-z]{3,4}|^\/lookup\//,
  },
  {
    kind: "zoom",
    label: "Join Zoom meeting",
    host: /^(?:[\w-]+\.)?zoom(?:gov)?\.(?:us|com)$/,
    path: /^\/(?:j|my|w|s)\//,
  },
];

/** Outlook's Safe Links wrap an address as ?url=…; the meeting is the address inside. */
const unwrap = (url: URL): URL => {
  if (!/(^|\.)safelinks\.protection\.outlook\.com$/.test(url.hostname)) return url;
  try {
    return new URL(url.searchParams.get("url") ?? "");
  } catch {
    return url;
  }
};

const URLS = /https:\/\/[^\s<>"'`\]]+/g;

/** The meeting link a piece of text holds, if any. */
const linkIn = (text: string): JoinLink | null => {
  for (const match of text.matchAll(URLS)) {
    let url: URL;
    try {
      url = unwrap(new URL(match[0].replace(/[).,;:!?]+$/, "")));
    } catch {
      continue;
    }
    if (url.protocol !== "https:") continue;
    const found = KINDS.find(
      ({ host, path }) => host.test(url.hostname.toLowerCase()) && path.test(url.pathname),
    );
    if (found && url.href.length <= 2048)
      return { kind: found.kind, url: url.href, label: found.label };
  }
  return null;
};

/** The first meeting link in `texts`, read in order: put the fields meant for it first. */
export const joinLinkIn = (...texts: (string | null | undefined)[]): JoinLink | null => {
  for (const text of texts) {
    const found = text ? linkIn(text) : null;
    if (found) return found;
  }
  return null;
};
