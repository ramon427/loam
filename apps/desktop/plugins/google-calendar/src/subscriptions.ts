import { EVENT_COLORS } from "./googleEvents";

/*
 * The calendars the user subscribes to by their ICS address, shown read-only beside the
 * Google account's: Outlook's published calendars, Google's secret iCal addresses. The list
 * is kept in the plugin store under `subscriptions`; it replaces the old `urls` setting, whose
 * addresses are carried over once.
 */

export type Subscription = {
  id: string;
  name: string;
  url: string;
  /** #rrggbb */
  color: string;
  /** Off: kept in the list but not fetched or shown. */
  enabled: boolean;
  /** Named by Loam, not the user: the feed's own name replaces it once it is read. */
  autoName?: boolean;
};

/**
 * The hosts the manifest is granted (as network:<host>); any other address is refused before
 * it is fetched. Outlook publishes from outlook.office365.com, and some tenants and personal
 * accounts from outlook.office.com or outlook.live.com.
 */
export const SUBSCRIPTION_HOSTS = [
  "calendar.google.com",
  "outlook.office365.com",
  "outlook.office.com",
  "outlook.live.com",
] as const;

/** The colors a subscription can take, in the order new ones get them. */
export const SUBSCRIPTION_COLORS = ["6", "3", "2", "5", "4", "9", "10", "8"].map(
  (id) => EVENT_COLORS[id]!.hex,
);

/** A pasted address as it is fetched: trimmed, and webcal:// read over https. */
export const normalizeUrl = (input: string) => input.trim().replace(/^webcals?:\/\//i, "https://");

/** Why an address can't be subscribed to, or null when it can. */
export const urlProblem = (url: string) => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "That isn't a web address. Paste the calendar's ICS link.";
  }
  if (parsed.protocol !== "https:") return "Use the calendar's https:// or webcal:// link.";
  if (!(SUBSCRIPTION_HOSTS as readonly string[]).includes(parsed.hostname.toLowerCase()))
    return "Loam can read calendars from Outlook (outlook.office365.com, outlook.office.com, outlook.live.com) and Google (calendar.google.com).";
  return null;
};

export type Provider = "outlook" | "google" | "other";

export const providerOf = (url: string): Provider => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.startsWith("outlook.")) return "outlook";
    if (host === "calendar.google.com") return "google";
  } catch {
    // Not an address: no provider.
  }
  return "other";
};

/**
 * The name a new subscription gets: the feed's own (X-WR-CALNAME), unless it is Outlook's
 * generic "Calendar", which says nothing beside the user's other calendars.
 */
export const defaultName = (url: string, feedName: string) => {
  const name = feedName.trim().slice(0, 100);
  if (name && !/^calendar$/i.test(name)) return name;
  const provider = providerOf(url);
  return provider === "outlook"
    ? "Work calendar"
    : provider === "google"
      ? "Google calendar"
      : "Calendar";
};

/** The first color no subscription has yet, cycling once all are taken. */
export const nextColor = (list: readonly Subscription[]) =>
  SUBSCRIPTION_COLORS.find((color) => !list.some((item) => item.color === color)) ??
  SUBSCRIPTION_COLORS[list.length % SUBSCRIPTION_COLORS.length]!;

const newId = (list: readonly Subscription[]) => {
  let index = list.length + 1;
  while (list.some((item) => item.id === `s${index}`)) index += 1;
  return `s${index}`;
};

/** A new subscription at the end of the list. */
export const addSubscription = (
  list: readonly Subscription[],
  url: string,
  name: string,
  autoName = false,
): Subscription[] => [
  ...list,
  {
    id: newId(list),
    name,
    url,
    color: nextColor(list),
    enabled: true,
    ...(autoName && { autoName }),
  },
];

const isHex = (value: unknown): value is string =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

/** The list as stored, keeping only well-formed entries; null if none was ever stored. */
export const readSubscriptions = (saved: unknown): Subscription[] | null => {
  if (!Array.isArray(saved)) return null;
  const list: Subscription[] = [];
  for (const item of saved as Partial<Subscription>[]) {
    if (!item || typeof item.id !== "string" || typeof item.url !== "string") continue;
    if (list.some((other) => other.id === item.id)) continue;
    list.push({
      id: item.id.slice(0, 40),
      url: item.url.slice(0, 2000),
      name:
        typeof item.name === "string" && item.name.trim() ? item.name.slice(0, 100) : "Calendar",
      color: isHex(item.color) ? item.color : nextColor(list),
      enabled: item.enabled !== false,
      ...(item.autoName === true && { autoName: true }),
    });
  }
  return list;
};

/** The addresses in the old `urls` setting, separated by spaces, commas or new lines. */
const legacyUrls = (setting: unknown) =>
  typeof setting === "string"
    ? [
        ...new Set(
          setting
            .split(/[\s,]+/)
            .map(normalizeUrl)
            .filter(Boolean),
        ),
      ]
    : [];

/**
 * The subscriptions to use, and whether they need saving: the stored list, or on first run
 * one subscription per address in the old setting (named once each is fetched).
 */
export const migrateSubscriptions = (saved: unknown, oldSetting: unknown) => {
  const stored = readSubscriptions(saved);
  if (stored) return { list: stored, changed: false };
  let list: Subscription[] = [];
  for (const url of legacyUrls(oldSetting))
    list = addSubscription(list, url, defaultName(url, ""), true);
  return { list, changed: true };
};
