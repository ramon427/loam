import { VideoTab } from "../video/VideoTab";
import type { NoteDocument } from "../workspace/types";

import { TabStrip } from "./TabStrip";
import type { NoteTabEdits } from "./useNoteTabEdits";
import type { NoteVideo } from "./useNoteVideo";

/** The open note's tabs, with its video's tab at the far end. */
export function NoteViewTabs({
  note,
  activeTabId,
  besideTabId,
  onSelect,
  onShowBeside,
  edits,
  video,
}: {
  note: NoteDocument;
  activeTabId: string;
  besideTabId: string | null;
  onSelect: (tabId: string) => void;
  onShowBeside: (tabId: string | null) => void;
  edits: NoteTabEdits;
  video: NoteVideo;
}) {
  return (
    <TabStrip
      note={note}
      activeTabId={activeTabId}
      onSelect={onSelect}
      besideTabId={besideTabId}
      onShowBeside={onShowBeside}
      onAdd={edits.addTab}
      onRename={edits.renameTab}
      onDelete={edits.deleteTab}
      onChangeKind={edits.changeKind}
      onMove={edits.moveTab}
      trailing={
        <VideoTab
          title={note.video?.title}
          hasVideo={video.hasVideo}
          open={video.pane.isOpen}
          maximized={video.pane.isMaximized}
          onToggle={video.toggleVideo}
          onToggleMaximized={video.pane.toggleMaximized}
          onChangeVideo={video.changeVideo}
          onRemoveVideo={video.removeVideo}
        />
      }
    />
  );
}
