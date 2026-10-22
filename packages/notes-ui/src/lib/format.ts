const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** A moment in the user's locale, such as "Oct 9, 2026, 9:00 AM". */
export const formatDateTime = (time: number) => dateTime.format(time);

/** A file size in KB below a megabyte, otherwise in MB. */
export const formatSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
