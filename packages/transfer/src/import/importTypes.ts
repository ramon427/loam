import type {
  BridgeImportFile,
  BridgeImportImageRequest,
  BridgeImportImageResult,
  BridgeImportNote,
  BridgeImportSkip,
} from "@loam/shared/bridge/loamBridge";

/** What every importer gets; each uses the parts its format needs. */
export type ImportConverterInput = {
  files: BridgeImportFile[];
  /**
   * Every note gets a fresh id, even one exported with `loam-id`: a deleted
   * note keeps its id reserved, so reusing ids could fail partway through.
   */
  createId: () => string;
  /** BlockNote's own parsers, so imported blocks match what the editor makes. */
  parseMarkdown: (markdown: string) => unknown[] | Promise<unknown[]>;
  parseHtml: (html: string) => unknown[] | Promise<unknown[]>;
  /** Copies images that sit next to the imported files, in request order. */
  saveImages: (requests: BridgeImportImageRequest[]) => Promise<BridgeImportImageResult[]>;
  /** Saves an image carried inside an export file and returns its media URL. */
  saveImageBytes: (bytes: Uint8Array<ArrayBuffer>) => Promise<string>;
  /** Called as notes are converted, with how many are done out of how many. */
  onProgress?: ImportProgressListener;
};

export type ImportConverterOutput = { notes: BridgeImportNote[]; skipped: BridgeImportSkip[] };

export type ImportConverter = (input: ImportConverterInput) => Promise<ImportConverterOutput>;

const PROGRESS_EVERY = 25;

/**
 * Counts converted notes, reports progress and yields to the event loop every
 * few notes. Parsing needs the window's DOM, so it can't move to a worker;
 * yielding keeps the window responsive and lets the progress text repaint.
 */
export const createImportProgress = (total: number, onProgress?: ImportProgressListener) => {
  let done = 0;
  return async () => {
    done += 1;
    if (done % PROGRESS_EVERY !== 0 && done !== total) return;
    onProgress?.(done, total);
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
};

export type ImportProgressListener = (done: number, total: number) => void;
