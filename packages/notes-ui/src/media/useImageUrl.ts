import { mediaSrc } from "./mediaSrc";

/**
 * The display URL for a stored image reference. Local media URLs are stable, so
 * this resolves synchronously and is never loading. Every size resolves to the
 * original file: the desktop app stores no preview derivatives.
 */
export const useImageUrl = (path?: string | null, _options?: { preferred?: "preview" }) => ({
  url: path ? (mediaSrc(path) ?? "") : "",
  isLoading: false,
});
