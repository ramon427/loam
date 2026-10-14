import { z } from "zod";

import { isLocalMediaImageUrl, isSafeMediaPath } from "./mediaFiles";

const maxImageReferenceLength = 2048;
const absoluteUrlPattern = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

/** A site-relative path such as `/images/a.png`; `//host` is a remote URL, not a path. */
const isRelativeImagePath = (value: string) =>
  value.startsWith("/") && !value.startsWith("//") && isSafeMediaPath(value.slice(1));

/** Notes store images as media paths; a local media URL is accepted and normalized later. */
export const isSafeImageReference = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxImageReferenceLength) return false;
  if (trimmed.startsWith("//")) return false;
  if (trimmed.startsWith("/")) return isRelativeImagePath(trimmed);
  if (absoluteUrlPattern.test(trimmed)) return isLocalMediaImageUrl(trimmed);
  return isSafeMediaPath(trimmed);
};

export const imageReferenceSchema = z
  .string()
  .trim()
  .max(maxImageReferenceLength)
  .refine(isSafeImageReference, {
    message: "Image URL must be a stored image path or a local media URL.",
  });
