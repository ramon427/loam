import { buildYouTubeEmbedUrl, parseYouTubeUrl } from "@loam/shared/notes/noteVideo";

import { readMediaFileName } from "@loam/shared/notes/mediaFiles";

import { mediaSrc } from "../media/mediaSrc";

/** What an embed tab shows for its address, and where the frame or image loads it from. */
export type EmbedView =
  | { type: "page"; src: string; address: string }
  | { type: "image"; src: string; address: string | null };

const IMAGE_PATH = /\.(?:avif|gif|jpe?g|png|webp)$/i;

/**
 * An address as typed, made one an embed tab can keep: "example.com" means
 * https, and only https pages and stored images can be shown.
 */
export const readEmbedAddress = (typed: string): string | null => {
  const trimmed = typed.trim();
  if (!trimmed) return null;
  if (readMediaFileName(trimmed)) return trimmed;
  const withScheme = /^[a-z][a-z\d+\-.]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  if (!URL.canParse(withScheme)) return null;
  const url = new URL(withScheme);
  return url.protocol === "https:" && url.hostname ? url.href : null;
};

/** How to show a stored address: YouTube links play in YouTube's player. */
export const viewEmbed = (address: string): EmbedView | null => {
  if (readMediaFileName(address)) {
    const src = mediaSrc(address);
    return src ? { type: "image", src, address: null } : null;
  }
  const readable = readEmbedAddress(address);
  if (!readable) return null;
  const video = parseYouTubeUrl(readable);
  if (video)
    return {
      type: "page",
      src: buildYouTubeEmbedUrl(video.videoId, video.startSeconds),
      address: readable,
    };
  if (IMAGE_PATH.test(new URL(readable).pathname))
    return { type: "image", src: readable, address: readable };
  return { type: "page", src: readable, address: readable };
};
