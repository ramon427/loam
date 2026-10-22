import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { onAppEvent } from "../lib/appEventBus";
import { asNumber, readPreference, removePreference, writePreference } from "../lib/preferences";

import type { NoteDocument } from "../workspace/types";
import { clamp } from "../lib/clamp";

export const MIN_VIDEO_PANE_WIDTH = 320;
export const MAX_VIDEO_PANE_WIDTH = 760;
const DEFAULT_VIDEO_PANE_WIDTH = 420;
const WIDTH_KEY = "video-pane-width";
/** Playback moves the position saved in the note at most this often. */
const SAVE_POSITION_EVERY_SECONDS = 15;

export const wholeSeconds = (seconds: number) => Math.max(0, Math.floor(seconds));
const clampWidth = (width: number) => clamp(width, MIN_VIDEO_PANE_WIDTH, MAX_VIDEO_PANE_WIDTH);

/** How a note's video pane was left, kept per note on this computer. */
type VideoView = { open: boolean; maximized: boolean; videoId: string | null; seconds: number };

const viewKey = (noteId: string) => `video-view:${noteId}`;

const readView = (value: unknown): Partial<VideoView> | null => {
  if (!value || typeof value !== "object") return null;
  const view = value as Record<string, unknown>;
  return {
    open: typeof view.open === "boolean" ? view.open : undefined,
    maximized: view.maximized === true,
    videoId: typeof view.videoId === "string" ? view.videoId : null,
    seconds: wholeSeconds(asNumber(view.seconds) ?? 0),
  };
};

/** Forgets how a deleted note's video pane was left. */
export const forgetVideoView = (noteId: string) => removePreference(viewKey(noteId));

const initialView = (note: NoteDocument): VideoView => {
  const stored = readPreference(viewKey(note.id), readView);
  const videoId = note.video?.videoId ?? null;
  return {
    open: stored?.open ?? Boolean(videoId),
    maximized: stored?.maximized ?? false,
    videoId,
    // View mode doesn't save the position in the note; this computer remembers it.
    seconds:
      stored?.videoId === videoId && stored.seconds !== undefined
        ? stored.seconds
        : wholeSeconds(note.video?.lastWatchedSeconds ?? 0),
  };
};

/**
 * The video pane beside a note: whether it is open, its size, and where the
 * video is. `savePosition` writes the position into the note.
 */
export function useVideoPane({
  note,
  savePosition,
}: {
  note: NoteDocument;
  savePosition: (seconds: number) => void;
}) {
  const [view, setView] = useState(() => initialView(note));
  const [width, setWidth] = useState(() =>
    clampWidth(readPreference(WIDTH_KEY, asNumber) ?? DEFAULT_VIDEO_PANE_WIDTH),
  );
  /** Where the player starts when it appears. */
  const [startSeconds, setStartSeconds] = useState(view.seconds);
  const [seekRequest, setSeekRequest] = useState<{ seconds: number; id: number } | null>(null);
  const position = useRef(view.seconds);
  const savedPosition = useRef(wholeSeconds(note.video?.lastWatchedSeconds ?? 0));
  const videoId = note.video?.videoId ?? null;

  const remember = useCallback(
    (change: Partial<VideoView>) =>
      setView((current) => {
        const next = { ...current, ...change };
        writePreference(viewKey(note.id), next);
        return next;
      }),
    [note.id],
  );

  /** Writes the latest position into the note, if it moved. */
  const savePositionNow = useCallback(() => {
    if (!videoId || savedPosition.current === position.current) return;
    savedPosition.current = position.current;
    savePosition(position.current);
  }, [savePosition, videoId]);

  const open = useCallback(() => {
    // A player that is already showing keeps playing where it is.
    if (!view.open) setStartSeconds(position.current);
    remember({ open: true });
  }, [remember, view.open]);

  const close = useCallback(() => {
    savePositionNow();
    remember({ open: false });
  }, [remember, savePositionNow]);

  /** The player reports where it is about once a second. */
  const trackPosition = useCallback(
    (playing: string, seconds: number) => {
      if (playing !== videoId) return;
      position.current = wholeSeconds(seconds);
      remember({ videoId: playing, seconds: position.current });
      if (Math.abs(position.current - savedPosition.current) >= SAVE_POSITION_EVERY_SECONDS)
        savePositionNow();
    },
    [remember, savePositionNow, videoId],
  );

  /** Opens the pane and moves the video to `seconds`, as a timestamp link does. */
  const seekTo = useCallback(
    (seconds: number) => {
      if (!videoId) return;
      position.current = wholeSeconds(seconds);
      if (!view.open) setStartSeconds(position.current);
      remember({ open: true, videoId, seconds: position.current });
      savePositionNow();
      setSeekRequest((current) => ({ seconds: position.current, id: (current?.id ?? 0) + 1 }));
    },
    [remember, savePositionNow, videoId, view.open],
  );

  /** Starts a newly attached video at `seconds`, or resets the pane when the video is removed. */
  const resetForVideo = useCallback(
    (nextVideoId: string | null, seconds = 0) => {
      position.current = wholeSeconds(seconds);
      savedPosition.current = position.current;
      setStartSeconds(position.current);
      setSeekRequest(null);
      remember(
        nextVideoId
          ? { videoId: nextVideoId, seconds: position.current }
          : { open: false, maximized: false, videoId: null, seconds: 0 },
      );
    },
    [remember],
  );

  // AI clients open the pane through the window's automation.
  useEffect(
    () =>
      onAppEvent("notes:open-video", ({ detail }) => {
        if (!videoId) return;
        open();
        detail.respond(videoId);
      }),
    [open, videoId],
  );

  // Leaving the note keeps the position it reached.
  const saveOnLeave = useRef(savePositionNow);
  useEffect(() => {
    saveOnLeave.current = savePositionNow;
  });
  useEffect(() => () => saveOnLeave.current(), []);

  const startResize = (event: ReactPointerEvent<HTMLElement>) => {
    if (view.maximized) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    let latest = startWidth;
    const move = (moveEvent: PointerEvent) => {
      latest = clampWidth(startWidth + startX - moveEvent.clientX);
      setWidth(latest);
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      writePreference(WIDTH_KEY, latest);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
    window.addEventListener("pointercancel", end, { once: true });
  };

  return {
    isOpen: view.open,
    isMaximized: view.maximized,
    /** Where the video is, as the player last reported; it updates while it plays. */
    seconds: view.seconds,
    width,
    startSeconds,
    seekRequest,
    open,
    close,
    toggleMaximized: () => remember({ maximized: !view.maximized }),
    startResize,
    trackPosition,
    /** Where the video is, for a graph node made "at this moment". */
    position: useCallback(() => position.current, []),
    seekTo,
    resetForVideo,
  };
}
