const YOUTUBE_HOST_PATTERN = /(^|\.)youtube\.com$/i;
const YOUTU_BE_HOST_PATTERN = /(^|\.)youtu\.be$/i;
const YOUTUBE_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

export type ParsedYouTubeUrl = {
  url: string;
  videoId: string;
  startSeconds?: number;
};

const parsePositiveInteger = (value: string | null) => {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

const parseTimestampPart = (value: string) => {
  const match = value.match(/^(\d+)(h|m|s)?$/i);
  if (!match) return null;
  const amount = Number.parseInt(match[1] ?? "", 10);
  if (!Number.isFinite(amount)) return null;
  const unit = match[2]?.toLowerCase() ?? "s";
  if (unit === "h") return amount * 3600;
  if (unit === "m") return amount * 60;
  return amount;
};

export const parseVideoTimestamp = (value: string | number | undefined | null) => {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
  }
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }

  if (/^(?:\d+[hms])+$/i.test(trimmed)) {
    const parts = trimmed.match(/\d+[hms]/gi) ?? [];
    return parts.reduce((total, part) => total + (parseTimestampPart(part) ?? 0), 0);
  }

  const clockParts = trimmed.split(":").map((part) => Number.parseInt(part, 10));
  if (
    clockParts.length < 2 ||
    clockParts.length > 3 ||
    clockParts.some((part) => !Number.isInteger(part) || part < 0)
  ) {
    return null;
  }

  const seconds = clockParts[clockParts.length - 1] ?? 0;
  const minutes = clockParts[clockParts.length - 2] ?? 0;
  if (seconds >= 60 || minutes >= 60) return null;

  return clockParts.reduce((total, part) => total * 60 + part, 0);
};

const resolveUrlTimestamp = (url: URL) => {
  const direct = parsePositiveInteger(url.searchParams.get("start"));
  if (direct !== undefined) return direct;
  const time = url.searchParams.get("t");
  return parseVideoTimestamp(time) ?? undefined;
};

const normalizeWatchUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`;

export const parseYouTubeUrl = (value: string): ParsedYouTubeUrl | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  let videoId: string | null = null;

  if (YOUTU_BE_HOST_PATTERN.test(hostname)) {
    videoId = url.pathname.split("/").filter(Boolean)[0] ?? null;
  } else if (YOUTUBE_HOST_PATTERN.test(hostname)) {
    if (url.pathname === "/watch") {
      videoId = url.searchParams.get("v");
    } else {
      const [kind, id] = url.pathname.split("/").filter(Boolean);
      if (["embed", "shorts", "live"].includes(kind ?? "")) {
        videoId = id ?? null;
      }
    }
  }

  if (!videoId || !YOUTUBE_ID_PATTERN.test(videoId)) return null;

  return {
    url: normalizeWatchUrl(videoId),
    videoId,
    startSeconds: resolveUrlTimestamp(url),
  };
};

export const formatVideoTimestamp = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainingSeconds = safe % 60;
  const pad = (value: number) => String(value).padStart(2, "0");

  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(remainingSeconds)}`;
  }
  return `${minutes}:${pad(remainingSeconds)}`;
};

const normalizeEmbedOrigin = (origin?: string) => {
  if (!origin) return undefined;
  try {
    const parsed = new URL(origin);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.origin : undefined;
  } catch {
    return undefined;
  }
};

export const buildYouTubeEmbedUrl = (videoId: string, seconds = 0, origin?: string) => {
  const start = Math.max(0, Math.floor(seconds));
  const params = new URLSearchParams({
    autoplay: "0",
    rel: "0",
    modestbranding: "1",
    enablejsapi: "1",
  });
  if (start > 0) {
    params.set("start", String(start));
  }
  params.set("playsinline", "1");
  const embedOrigin = normalizeEmbedOrigin(origin);
  if (embedOrigin) {
    params.set("origin", embedOrigin);
  }
  return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
};

export const buildYouTubePlayerCommandMessage = (func: string, args: unknown[] = []) =>
  JSON.stringify({
    event: "command",
    func,
    args,
  });

export const buildYouTubePlayerListeningMessage = (id: string) =>
  JSON.stringify({
    event: "listening",
    id,
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parsePlayerMessage = (data: unknown) => {
  if (typeof data !== "string") return data;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return null;
  }
};

export const parseYouTubePlayerCurrentSeconds = (data: unknown) => {
  const payload = parsePlayerMessage(data);
  if (!isRecord(payload) || payload.event !== "infoDelivery") return null;
  const info = payload.info;
  if (!isRecord(info)) return null;
  const currentTime = info.currentTime;
  if (typeof currentTime !== "number" || !Number.isFinite(currentTime)) {
    return null;
  }
  return Math.max(0, Math.floor(currentTime));
};

/** YouTube's player states that mean the video is going: playing, and buffering to play. */
const PLAYING_STATES = new Set([1, 3]);

/** Whether a player message says the video is playing; null when it doesn't say. */
export const parseYouTubePlayerPlaying = (data: unknown) => {
  const payload = parsePlayerMessage(data);
  if (!isRecord(payload)) return null;
  let state: unknown = null;
  if (payload.event === "onStateChange") state = payload.info;
  else if (payload.event === "infoDelivery" && isRecord(payload.info))
    state = payload.info.playerState;
  return typeof state === "number" ? PLAYING_STATES.has(state) : null;
};
