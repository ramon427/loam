import { ExternalLinkIcon, LinkIcon, PlayIcon } from "lucide-react";

import { ActionMenuItem } from "../action-menu/ActionMenu";
import { copyLink } from "../lib/copyLink";
import { NoteRouteGlyph } from "../ui/NoteRouteIcon";
import type { NotePlace } from "../workspace/types";
import type { AppLinkTarget } from "./editorLinks";

/**
 * A right-click on a link in a note: follow it as a click would, and copy a note or web link.
 * `text` is the link's text, and `target` its in-app target, null for a link to the web.
 */
export function NoteLinkMenuItems({
  href,
  text,
  target,
  onOpenNote,
  onOpenPlace,
}: {
  href: string;
  text: string;
  target: AppLinkTarget | null;
  onOpenNote: (noteId: string) => void;
  onOpenPlace: (place: NotePlace) => void;
}) {
  if (target?.kind === "video" || target?.kind === "none") {
    // A timestamp in a note without a video has nothing to play.
    return (
      <ActionMenuItem
        icon={<PlayIcon aria-hidden="true" />}
        disabled={target.kind === "none"}
        onSelect={() => {
          if (target.kind === "video") onOpenPlace(target);
        }}
      >
        Play from here
      </ActionMenuItem>
    );
  }
  return (
    <>
      {target ? (
        <ActionMenuItem icon={<NoteRouteGlyph />} onSelect={() => onOpenNote(target.noteId)}>
          Open note
        </ActionMenuItem>
      ) : (
        // The main process opens web and mail links in the browser, and nothing else.
        <ActionMenuItem
          icon={<ExternalLinkIcon aria-hidden="true" />}
          onSelect={() => window.open(href)}
        >
          Open link
        </ActionMenuItem>
      )}
      <ActionMenuItem
        icon={<LinkIcon aria-hidden="true" />}
        onSelect={() => void copyLink(href, text.trim() || href)}
      >
        Copy link
      </ActionMenuItem>
    </>
  );
}
