import { randomUUID } from "node:crypto";

import type {
  BridgeImportImageRequest,
  BridgeImportImageResult,
  BridgeImportNote,
  BridgeImportPick,
  BridgeImportResult,
  BridgeImportSource,
} from "@loam/shared/bridge/loamBridge";
import type { NotesStore } from "@loam/storage/NotesStore";
import { StoreError } from "@loam/storage/storeError";

import { imageTypeOf, type MediaStore } from "../mediaStore";
import type { Caller } from "../requests/dispatch";
import { placeImportedNotes, writeImportedNotes, type ImportedNotePlacement } from "./placement";
import { detectImport, IMPORT_LIMITS, readImport, type ImageSource } from "./readers";

const SESSION_TTL_MS = 60 * 60 * 1000;
/** Sessions open at once; a window import replaces the window's previous one. */
const MAX_SESSIONS = 8;

type ImportSession = {
  id: string;
  owner: Caller;
  images: ImageSource;
  /** Set once the work before the first write (a safety backup) has run. */
  prepared: boolean;
  saved: Map<string, BridgeImportImageResult>;
  placements: ImportedNotePlacement[];
  expiresAt: number;
};

/**
 * Imports run in steps so large libraries never cross the bridge at once:
 * pick reads the files, images copies what notes refer to, write creates notes
 * in batches, and finish places them into folders with one library save.
 */
export const createNotesImporter = ({
  store,
  media,
  beforeFirstWrite = async () => undefined,
  now = Date.now,
}: {
  store: NotesStore;
  media: MediaStore;
  /** Runs once per import before its first note is written, e.g. to take a backup. */
  beforeFirstWrite?: () => Promise<unknown>;
  now?: () => number;
}) => {
  // UI imports and AI imports have separate sessions, so one cannot replace the other.
  const sessions = new Map<string, ImportSession>();
  let uiSessionId: string | null = null;

  const requireSession = (sessionId: string) => {
    const session = sessions.get(sessionId);
    if (!session || session.expiresAt < now())
      throw new StoreError("This import has expired. Start it again.", "IMPORT_EXPIRED", 410);
    return session;
  };

  const saveImage = async (
    session: ImportSession,
    request: BridgeImportImageRequest,
  ): Promise<BridgeImportImageResult> => {
    const path = await session.images.locate(request);
    if (!path) return { skipped: "Image file not found" };
    const cached = session.saved.get(path);
    if (cached) return cached;
    const bytes = await session.images.read(path);
    let result: BridgeImportImageResult;
    if (!(bytes instanceof Uint8Array)) result = bytes;
    else if (!imageTypeOf(bytes))
      result = { skipped: "Image type is not supported (use PNG, JPEG, GIF, WebP or AVIF)" };
    else result = { url: (await media.saveImage(bytes)).url };
    session.saved.set(path, result);
    return result;
  };

  return {
    /**
     * Reads what was picked for an import and starts its session. `paths` is
     * what the window's picker returned (empty when canceled), what was dropped
     * on it and confirmed, or what an AI client named; a new window import
     * replaces the window's previous one. "auto" tells the source from the paths.
     */
    async pick(
      requested: BridgeImportSource | "auto",
      paths: readonly string[],
      owner: Caller,
    ): Promise<BridgeImportPick> {
      if (paths.length === 0) return { status: "canceled" };
      if (paths.length > IMPORT_LIMITS.files)
        throw new StoreError("Too many files to import at once.", "VALIDATION_ERROR", 400);
      for (const [id, session] of sessions) if (session.expiresAt < now()) sessions.delete(id);
      if (
        sessions.size >= MAX_SESSIONS &&
        !(owner === "window" && uiSessionId && sessions.has(uiSessionId))
      )
        throw new StoreError("Finish an existing import before starting another.", "CONFLICT", 409);
      const { source, pick } =
        requested === "auto" ? await detectImport(paths) : { source: requested, pick: undefined };
      const read = await readImport(source, paths, pick);
      const session: ImportSession = {
        id: randomUUID(),
        owner,
        images: read.images,
        prepared: false,
        saved: new Map(),
        placements: [],
        expiresAt: now() + SESSION_TTL_MS,
      };
      if (owner === "window") {
        if (uiSessionId) sessions.delete(uiSessionId);
        uiSessionId = session.id;
      }
      sessions.set(session.id, session);
      return {
        status: "picked",
        source,
        sessionId: session.id,
        name: read.name,
        files: read.files,
        skipped: read.skipped,
      };
    },

    /** Copies the images notes refer to; results follow the requests' order. */
    async images(
      sessionId: string,
      requests: readonly BridgeImportImageRequest[],
    ): Promise<BridgeImportImageResult[]> {
      const session = requireSession(sessionId);
      const results: BridgeImportImageResult[] = [];
      for (const request of requests) results.push(await saveImage(session, request));
      return results;
    },

    /** Creates a batch of converted notes at the top level; `finish` files them. */
    async write(
      sessionId: string,
      notes: readonly BridgeImportNote[],
    ): Promise<{ written: number }> {
      const session = requireSession(sessionId);
      if (!session.prepared) {
        await beforeFirstWrite();
        session.prepared = true;
      }
      const placements = await writeImportedNotes(store, notes, {
        external: session.owner === "ai",
      });
      session.placements.push(...placements);
      return { written: placements.length };
    },

    /**
     * Files every written note into its folder and ends the session. Call it
     * after a failed import too: what was written is kept and filed.
     */
    async finish(sessionId: string): Promise<BridgeImportResult> {
      const session = requireSession(sessionId);
      sessions.delete(session.id);
      if (session.placements.length === 0) return { noteCount: 0, folderCount: 0 };
      const { folderCount } = await placeImportedNotes(store, session.placements, randomUUID, {
        external: session.owner === "ai",
      });
      return { noteCount: session.placements.length, folderCount };
    },
  };
};
