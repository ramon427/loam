import { useQuery } from "@tanstack/react-query";

import { callBridge } from "../bridge";

const isoDatePattern = /^(\d{4})-(\d{2})-(\d{2})/;
const backlinkDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** Format the date part without a time zone shift. */
export const formatBacklinkDate = (value: string) => {
  const match = isoDatePattern.exec(value);
  if (!match) return value;
  return backlinkDateFormatter.format(
    new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))),
  );
};

/** The notes that link to `noteId`; the workspace reads them again after every save. */
export const useNoteBacklinks = (noteId: string) =>
  useQuery({
    queryKey: ["note-backlinks", noteId],
    queryFn: () => callBridge("notes.backlinks", { noteId }),
    refetchOnMount: "always",
  });
