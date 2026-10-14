import { callBridge } from "../bridge";
import type { BridgeImportFile, BridgeImportSource } from "@loam/shared/bridge/loamBridge";
import { createUuid } from "@loam/shared/utils/uuid";

/**
 * Turns the files an import read into notes with the editor's own parsers,
 * saving the images they show along the way. The import screen and AI
 * imports both convert through here.
 */
export const convertImport = async ({
  source,
  sessionId,
  files,
  onProgress,
}: {
  source: BridgeImportSource;
  sessionId: string;
  files: BridgeImportFile[];
  onProgress?: (done: number, total: number) => void;
}) => {
  // The converters and BlockNote's parsers load with the first import.
  const [{ IMPORT_CONVERTERS }, { parseHtml, parseMarkdown }] = await Promise.all([
    import("./importConverters"),
    import("../editor/blockParsers"),
  ]);
  return IMPORT_CONVERTERS[source]({
    files,
    createId: createUuid,
    parseMarkdown,
    parseHtml,
    saveImages: (requests) => callBridge("import.images", { sessionId, requests }),
    saveImageBytes: async (bytes) => (await callBridge("media.saveImage", { bytes })).url,
    onProgress,
  });
};
