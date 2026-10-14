import { ClockIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";

import { currentVideoTimestamp, type NoteVideoTimestamp } from "../editor/noteMentions";
import { ShortcutHint } from "../keyboard/ShortcutHint";
import { formatShortcut } from "../keyboard/shortcuts";
import { Button } from "../ui/Button";
import { cn } from "../ui/cn";
import type { NoteVideo } from "@loam/shared/notes/noteModel";
import {
  buildYouTubeEmbedUrl,
  buildYouTubePlayerCommandMessage,
  buildYouTubePlayerListeningMessage,
  formatVideoTimestamp,
  parseYouTubePlayerCurrentSeconds,
  parseYouTubePlayerPlaying,
} from "@loam/shared/notes/noteVideo";

import { wholeSeconds } from "./useVideoPane";

const YOUTUBE_PLAYER_ORIGIN = "https://www.youtube.com";

/** What the note asks of the player, such as its play/pause shortcut. */
export type VideoPlayerCommands = { togglePlayback(): void };

/**
 * The note's YouTube video and the timestamps its text links to, each with
 * the line it stands in; the one playing is marked. While a page tab shows,
 * a button (and its shortcut) writes the current moment into the text. The
 * player is driven through YouTube's postMessage API.
 */
export function NoteVideoPlayer({
  video,
  timestamps,
  startSeconds,
  seekRequest,
  canInsertTimestamp,
  commands,
  onPosition,
  onSeek,
  onInsertTimestamp,
}: {
  video: NoteVideo;
  timestamps: readonly NoteVideoTimestamp[];
  /** Where the video starts when it loads. */
  startSeconds: number;
  seekRequest: { seconds: number; id: number } | null;
  canInsertTimestamp: boolean;
  commands: Ref<VideoPlayerCommands | null>;
  /** The player's position, reported about once a second. */
  onPosition: (videoId: string, seconds: number) => void;
  onSeek: (seconds: number) => void;
  onInsertTimestamp: (seconds: number) => void;
}) {
  const { videoId } = video;
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const playerId = `note-video-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const listId = useId();
  const [seconds, setSeconds] = useState(wholeSeconds(startSeconds));
  const playing = useRef(false);
  const appliedSeekId = useRef<number | null>(null);
  const current = currentVideoTimestamp(timestamps, seconds);

  const send = useCallback((func: string, args: unknown[] = []) => {
    iframeRef.current?.contentWindow?.postMessage(
      buildYouTubePlayerCommandMessage(func, args),
      YOUTUBE_PLAYER_ORIGIN,
    );
  }, []);

  useImperativeHandle(
    commands,
    () => ({ togglePlayback: () => send(playing.current ? "pauseVideo" : "playVideo") }),
    [send],
  );

  const report = useEffectEvent((next: number) => {
    setSeconds(wholeSeconds(next));
    onPosition(videoId, next);
  });

  // The player answers with its position and state; only this iframe's messages count.
  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (event.origin !== YOUTUBE_PLAYER_ORIGIN) return;
      if (iframeRef.current?.contentWindow && event.source !== iframeRef.current.contentWindow)
        return;
      const position = parseYouTubePlayerCurrentSeconds(event.data);
      if (position !== null) report(position);
      const isPlaying = parseYouTubePlayerPlaying(event.data);
      if (isPlaying !== null) playing.current = isPlaying;
    };
    window.addEventListener("message", listen);
    const poll = window.setInterval(() => send("getCurrentTime"), 1000);
    return () => {
      window.removeEventListener("message", listen);
      window.clearInterval(poll);
    };
  }, [send, videoId]);

  useEffect(() => {
    if (!seekRequest || appliedSeekId.current === seekRequest.id) return;
    appliedSeekId.current = seekRequest.id;
    report(seekRequest.seconds);
    send("seekTo", [seekRequest.seconds, true]);
    const confirm = window.setTimeout(() => send("getCurrentTime"), 250);
    return () => window.clearTimeout(confirm);
  }, [seekRequest, send, videoId]);

  const connectPlayer = () => {
    playing.current = false;
    iframeRef.current?.contentWindow?.postMessage(
      buildYouTubePlayerListeningMessage(playerId),
      YOUTUBE_PLAYER_ORIGIN,
    );
    send("addEventListener", ["onStateChange"]);
    send("getCurrentTime");
    if (seekRequest) send("seekTo", [seekRequest.seconds, true]);
    send("pauseVideo");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-note-video-playback-seconds={seconds}>
      <div className="overflow-hidden rounded-md bg-black">
        <iframe
          ref={iframeRef}
          // A new video, or a new starting point for it, loads a fresh player.
          key={`${videoId}:${startSeconds}`}
          title={video.title || "Note video"}
          src={buildYouTubeEmbedUrl(videoId, wholeSeconds(startSeconds), window.location.origin)}
          className="aspect-video w-full"
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={connectPlayer}
          allowFullScreen
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-(--app-muted)">
        {canInsertTimestamp ? (
          <ShortcutHint label="Insert the current moment" shortcut="video.timestamp">
            <Button
              variant="ghost-muted"
              size="sm"
              className="-ml-2 h-7 gap-1.5 px-2 tabular-nums"
              onClick={() => onInsertTimestamp(seconds)}
            >
              <ClockIcon className="size-3.5" />
              Insert {formatVideoTimestamp(seconds)}
            </Button>
          </ShortcutHint>
        ) : (
          <span className="tabular-nums">{formatVideoTimestamp(seconds)}</span>
        )}
        <span>
          <kbd className="font-sans">{formatShortcut("video.play-pause")}</kbd> plays or pauses
        </span>
      </div>

      <section aria-labelledby={listId} className="min-h-0 space-y-1">
        <h3 id={listId} className="text-xs font-medium text-(--app-muted)">
          Timestamps
        </h3>
        {timestamps.length > 0 ? (
          <ul className="space-y-0.5">
            {timestamps.map((timestamp) => {
              const label = formatVideoTimestamp(timestamp.seconds);
              const isCurrent = timestamp === current;
              return (
                <li key={timestamp.seconds}>
                  <button
                    type="button"
                    aria-label={`Seek video to ${label}`}
                    aria-current={isCurrent ? "true" : undefined}
                    onClick={() => onSeek(timestamp.seconds)}
                    className={cn(
                      "flex w-full min-w-0 items-baseline gap-2.5 rounded-md px-2 py-1 text-left text-[13px] leading-snug text-(--app-text) outline-none hover:bg-(--app-page-2) focus-visible:ring-2 focus-visible:ring-(--focus-ring)",
                      isCurrent && "bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)]",
                    )}
                  >
                    <span
                      className={cn(
                        "w-12 shrink-0 font-mono text-xs tabular-nums text-(--app-muted)",
                        isCurrent && "text-(--app-accent)",
                      )}
                    >
                      {label}
                    </span>
                    <span className="line-clamp-2 min-w-0">
                      {timestamp.text || <span className="text-(--app-muted)">No text</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-xs text-(--app-muted)">
            {canInsertTimestamp
              ? `None yet. Press ${formatShortcut("video.timestamp")} while you write to link this moment.`
              : "None yet."}
          </p>
        )}
      </section>
    </div>
  );
}
