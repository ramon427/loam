import { useMemo, useState } from "react";

import { MAX_NOTE_HEADING_CONNECTIONS_PER_TARGET } from "@loam/shared/notes/headingConnections";

import { SearchField } from "../ui/SearchField";
import {
  HeadingConnectionDialog,
  HeadingConnectionListEmpty,
  HeadingConnectionOption,
  matchesSearch,
} from "./HeadingConnectionDialog";
import type { NoteHeadingConnectionOption } from "./noteHeadingConnections";

/** Picks the headings a graph node, table row or table column connects to. */
export function HeadingConnectionManager({
  open,
  onOpenChange,
  targetLabel,
  headingOptions,
  selectedHeadingBlockIds,
  readOnly,
  onToggleHeading,
  onOpenHeading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetLabel: string;
  headingOptions: readonly NoteHeadingConnectionOption[];
  selectedHeadingBlockIds: readonly string[];
  readOnly: boolean;
  onToggleHeading: (headingBlockId: string) => void;
  onOpenHeading: (headingBlockId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const selectedIds = useMemo(() => new Set(selectedHeadingBlockIds), [selectedHeadingBlockIds]);
  const isAtConnectionLimit = selectedIds.size >= MAX_NOTE_HEADING_CONNECTIONS_PER_TARGET;
  const visibleOptions = useMemo(
    () =>
      headingOptions.filter((heading) =>
        matchesSearch([heading.title, heading.tabTitle, `Heading ${heading.level}`], query),
      ),
    [headingOptions, query],
  );
  const groupedOptions = useMemo(() => {
    const groups = new Map<string, { tabTitle: string; headings: NoteHeadingConnectionOption[] }>();
    visibleOptions.forEach((heading) => {
      const group = groups.get(heading.tabId) ?? {
        tabTitle: heading.tabTitle,
        headings: [],
      };
      group.headings.push(heading);
      groups.set(heading.tabId, group);
    });
    return Array.from(groups.entries());
  }, [visibleOptions]);
  // The dialog stays mounted while closed, so the next opening starts unfiltered.
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setQuery("");
    onOpenChange(nextOpen);
  };

  return (
    <HeadingConnectionDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={`Headings connected to ${targetLabel}`}
      description="A node, row, or column can connect to more than one heading in this note."
    >
      <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-3 overflow-hidden p-4">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search headings"
          label="Search headings"
          autoFocus
        />
        <div className="min-h-0 overflow-y-auto" aria-label="Available note headings">
          {groupedOptions.length > 0 ? (
            <div className="grid gap-3">
              {groupedOptions.map(([tabId, group]) => (
                <section key={tabId} className="grid gap-1">
                  <h3 className="px-2 text-[11px] font-semibold tracking-normal text-(--app-muted)">
                    {group.tabTitle}
                  </h3>
                  {group.headings.map((heading) => (
                    <HeadingConnectionOption
                      key={heading.headingBlockId}
                      checked={selectedIds.has(heading.headingBlockId)}
                      disabled={
                        readOnly ||
                        (isAtConnectionLimit && !selectedIds.has(heading.headingBlockId))
                      }
                      label={heading.title}
                      detail={`Heading ${heading.level}${heading.isToggleable ? " · Toggle" : ""}${
                        heading.connectionCount > 0
                          ? ` · ${heading.connectionCount} connection${
                              heading.connectionCount === 1 ? "" : "s"
                            }`
                          : ""
                      }`}
                      indent={heading.level - 1}
                      onToggle={() => onToggleHeading(heading.headingBlockId)}
                      onOpen={() => onOpenHeading(heading.headingBlockId)}
                    />
                  ))}
                </section>
              ))}
            </div>
          ) : (
            <HeadingConnectionListEmpty>
              {headingOptions.length === 0
                ? "Add a heading to a page tab first."
                : "No headings match this search."}
            </HeadingConnectionListEmpty>
          )}
        </div>
      </div>
    </HeadingConnectionDialog>
  );
}
