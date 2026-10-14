import { useCallback, useMemo, useRef, useState, type RefObject } from "react";

import type { ParsedYouTubeUrl } from "@loam/shared/notes/noteVideo";
import { currentVideoTimestamp, listNoteVideoTimestamps } from "../editor/noteMentions";
import type { PageTabCommands } from "../editor/PageTabEditor";
import { useShortcuts } from "../keyboard/useShortcuts";
import { toastMessage } from "../ui/toast";
import type { VideoPlayerCommands } from "../video/NoteVideoPlayer";
import { useVideoPane, wholeSeconds } from "../video/useVideoPane";
import type { NoteContentPatch } from "../workspace/NotesWorkspace";
import type { NoteDocument } from "../workspace/types";

type Update = (change: NoteContentPatch | ((latest: NoteDocument) => NoteContentPatch)) => void;

/**
 * A note's video: attaching, changing and removing it, its pane beside the
 * note, and the shortcuts that play it and link its moments from a page tab.
 */
export function useNoteVideo({
  note,
  update,
  pageCommands,
  pageInView,
}: {
  note: NoteDocument;
  update: Update;
  /** The page tab in view, which takes timestamps. */
  pageCommands: RefObject<PageTabCommands | null>;
  pageInView: boolean;
}) {
  /** The video column asks for a link: to add the first video, or to change it. */
  const [linkForm, setLinkForm] = useState<"add" | "change" | null>(null);
  const playerCommands = useRef<VideoPlayerCommands | null>(null);

  const savePosition = useCallback(
    (seconds: number) =>
      update((latest) =>
        latest.video ? { video: { ...latest.video, lastWatchedSeconds: seconds } } : {},
      ),
    [update],
  );
  const pane = useVideoPane({ note, savePosition });
  const hasVideo = Boolean(note.video?.videoId);
  const timestamps = useMemo(() => listNoteVideoTimestamps(note), [note]);
  const playingTimestamp =
    hasVideo && pane.isOpen
      ? (currentVideoTimestamp(timestamps, pane.seconds)?.seconds ?? null)
      : null;

  /**
   * Attaches a video and shows it. Timestamps stay: they may still fit, as
   * with another upload of the same talk, and each can be edited or removed.
   */
  const chooseVideo = (chosen: ParsedYouTubeUrl) => {
    const seconds = wholeSeconds(chosen.startSeconds ?? 0);
    update((latest) => ({
      video: {
        url: chosen.url,
        videoId: chosen.videoId,
        title: latest.video?.videoId === chosen.videoId ? latest.video.title : undefined,
        lastWatchedSeconds: seconds,
      },
    }));
    pane.resetForVideo(chosen.videoId, seconds);
    pane.open();
    setLinkForm(null);
  };

  const removeVideo = () => {
    update({ video: undefined });
    pane.resetForVideo(null);
    setLinkForm(null);
  };

  const closeVideo = () => {
    pane.close();
    setLinkForm(null);
  };

  const toggleVideo = () => {
    if (pane.isOpen) {
      closeVideo();
      return;
    }
    pane.open();
    if (!hasVideo) setLinkForm("add");
  };

  const changeVideo = () => {
    pane.open();
    setLinkForm("change");
  };

  /** A YouTube link pasted into a note without a video can become its video. */
  const offerPastedVideo = (pasted: ParsedYouTubeUrl) =>
    toastMessage("Watch this video beside the note?", {
      id: "note-video-paste",
      description: "Attach it to link moments of it from your text.",
      action: { label: "Attach", onClick: () => chooseVideo(pasted) },
    });

  const canInsertTimestamp = hasVideo && pageInView;
  useShortcuts([
    {
      id: "video.timestamp",
      enabled: canInsertTimestamp,
      allowInEditable: true,
      run: () => pageCommands.current?.insertVideoTimestamp(pane.position()),
    },
    {
      id: "video.play-pause",
      enabled: hasVideo,
      allowInEditable: true,
      run: () => {
        if (pane.isOpen && linkForm === null) playerCommands.current?.togglePlayback();
        else {
          pane.open();
          setLinkForm(null);
        }
      },
    },
  ]);

  return {
    pane,
    hasVideo,
    linkForm,
    cancelChange: () => setLinkForm(null),
    playerCommands,
    timestamps,
    playingTimestamp,
    canInsertTimestamp,
    chooseVideo,
    removeVideo,
    closeVideo,
    toggleVideo,
    changeVideo,
    offerPastedVideo,
  };
}

export type NoteVideo = ReturnType<typeof useNoteVideo>;
