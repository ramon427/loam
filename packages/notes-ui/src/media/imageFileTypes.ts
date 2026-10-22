const supportedImageMimeTypes = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

const supportedImageExtensions = new Set(["jpg", "jpeg", "png", "gif", "webp"]);

export const imageInputAccept =
  ".jpg,.jpeg,.png,.gif,.webp,image/jpeg,image/png,image/gif,image/webp";

export const imageUploadErrorMessage = "Only JPG, PNG, GIF, and WEBP files are allowed.";

export const isSupportedImageFile = (file: Pick<File, "name" | "type">) => {
  const normalizedType = file.type.trim().toLowerCase();
  if (normalizedType === "image/svg+xml") return false;
  if (supportedImageMimeTypes.has(normalizedType)) return true;

  const extension = file.name.split(".").pop()?.trim().toLowerCase() ?? "";
  return supportedImageExtensions.has(extension);
};
