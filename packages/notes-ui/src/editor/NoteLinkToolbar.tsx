import { useLayoutEffect } from "react";
import {
  DeleteLinkButton,
  EditLinkButton,
  LinkToolbar,
  useComponentsContext,
  type LinkToolbarProps,
} from "@blocknote/react";

import { readVideoTimestampHref } from "@loam/shared/notes/noteLinks";

import { readNoteLinkNoteId } from "./editorLinks";
import { useNoteLinkNavigation } from "./noteLinkNavigation";
import { NoteRouteGlyph } from "../ui/NoteRouteIcon";

function OpenNoteLinkButton({
  noteId,
  setToolbarOpen,
}: {
  noteId: string;
  setToolbarOpen?: (open: boolean) => void;
}) {
  const Components = useComponentsContext();
  const openNote = useNoteLinkNavigation();
  if (!Components || !openNote) return null;
  return (
    <Components.LinkToolbar.Button
      className="bn-button"
      mainTooltip="Open note"
      label="Open note"
      isSelected={false}
      onClick={() => {
        setToolbarOpen?.(false);
        openNote(noteId);
      }}
      icon={<NoteRouteGlyph className="size-4" />}
    />
  );
}

/**
 * The toolbar over a link while editing. A link to a note opens that note in
 * the app; a video timestamp is one chip with no toolbar.
 */
export const NoteLinkToolbar = (props: LinkToolbarProps) => {
  const isVideoTimestamp = readVideoTimestampHref(props.url) !== null;
  const { setToolbarOpen } = props;

  useLayoutEffect(() => {
    if (isVideoTimestamp) setToolbarOpen?.(false);
  }, [isVideoTimestamp, setToolbarOpen]);

  if (isVideoTimestamp) return null;
  const linkedNoteId = readNoteLinkNoteId(props.url);
  if (!linkedNoteId) return <LinkToolbar {...props} />;
  return (
    <LinkToolbar {...props}>
      <EditLinkButton {...props} />
      <OpenNoteLinkButton noteId={linkedNoteId} setToolbarOpen={setToolbarOpen} />
      <DeleteLinkButton range={props.range} setToolbarOpen={setToolbarOpen} />
    </LinkToolbar>
  );
};
