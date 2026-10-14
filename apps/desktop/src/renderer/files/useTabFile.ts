import { useEffect, useEffectEvent, useState } from "react";

import type { FileTabKind, NoteFile } from "@loam/shared/notes/noteModel";

import { callBridge, onBridgeEvent } from "../bridge";

export type TabFileState =
  | { status: "loading" }
  | { status: "ready"; bytes: Uint8Array; revision: number }
  | { status: "missing"; message: string };

/** What identifies a tab's file: changing any of these loads it again. */
const sourceKey = ({ source }: NoteFile) =>
  source.kind === "imported"
    ? `imported:${source.fileName}`
    : source.kind === "referenced"
      ? `referenced:${source.computerId}:${source.path}`
      : "text";

/** The linked file a tab watches on disk, if it has one. */
const linkedPathOf = ({ source }: NoteFile) => (source.kind === "referenced" ? source.path : null);

/**
 * A tab's file, read through the main process. A linked file is watched
 * while the tab shows it and read again whenever it changes on disk;
 * `revision` counts those reads. Text the note holds isn't read here.
 */
export function useTabFile(kind: FileTabKind, file: NoteFile): TabFileState {
  const [state, setState] = useState<TabFileState>({ status: "loading" });
  const key = sourceKey(file);
  const path = linkedPathOf(file);
  // Reads the tab's file as it is now; its page or name changing doesn't read it again.
  const read = useEffectEvent(() => callBridge("files.read", { kind, file }));

  useEffect(() => {
    let active = true;
    let revision = 0;
    const load = () => {
      void read().then(
        (bytes) => {
          revision += 1;
          if (active) setState({ status: "ready", bytes, revision });
        },
        (error: unknown) => {
          if (active)
            setState({
              status: "missing",
              message: error instanceof Error ? error.message : "This file can't be opened.",
            });
        },
      );
    };
    setState({ status: "loading" });
    load();
    if (!path) return () => void (active = false);
    void callBridge("files.watch", { kind, path }).catch(() => undefined);
    const stop = onBridgeEvent("files.changed", (changed) => {
      if (changed.path === path) load();
    });
    return () => {
      active = false;
      stop();
      void callBridge("files.unwatch", { path }).catch(() => undefined);
    };
  }, [kind, key, path]);

  return state;
}
