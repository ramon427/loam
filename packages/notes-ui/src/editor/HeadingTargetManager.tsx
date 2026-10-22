import { useMemo, useState } from "react";

import { MAX_NOTE_HEADING_CONNECTIONS_PER_TARGET } from "@loam/shared/notes/headingConnections";

import { PanelTabs } from "../ui/PanelTabs";
import { SearchField } from "../ui/SearchField";
import {
  HeadingConnectionDialog,
  HeadingConnectionListEmpty,
  HeadingConnectionOption,
  matchesSearch,
} from "./HeadingConnectionDialog";
import { headingTargetKindLabel, type NoteHeadingConnectionTarget } from "./noteHeadingConnections";

type TargetCategory = "graph" | "table";

const targetCategory = (target: NoteHeadingConnectionTarget): TargetCategory =>
  target.kind === "graph-node" ? "graph" : "table";

/**
 * Picks the graph nodes, table rows and table columns a heading connects to.
 * It is mounted only while open, so each opening starts unfiltered.
 */
export function HeadingTargetManager({
  onClose,
  headingBlockId,
  headingLabel,
  targets,
  readOnly,
  onToggleTarget,
  onOpenTarget,
}: {
  onClose: () => void;
  headingBlockId: string;
  headingLabel: string;
  targets: readonly NoteHeadingConnectionTarget[];
  readOnly: boolean;
  onToggleTarget: (target: NoteHeadingConnectionTarget) => void;
  onOpenTarget: (target: NoteHeadingConnectionTarget) => void;
}) {
  const [query, setQuery] = useState("");
  const availableCategories = useMemo(
    () => Array.from(new Set(targets.map(targetCategory))),
    [targets],
  );
  const [chosenCategory, setChosenCategory] = useState<TargetCategory>(
    availableCategories[0] ?? "graph",
  );
  // The chosen kind can lose its last target while the dialog is open.
  const category = availableCategories.includes(chosenCategory)
    ? chosenCategory
    : (availableCategories[0] ?? "graph");

  const visibleTargets = useMemo(
    () =>
      targets.filter(
        (target) =>
          targetCategory(target) === category &&
          matchesSearch(
            [target.title, target.tabTitle, headingTargetKindLabel(target.kind)],
            query,
          ),
      ),
    [category, query, targets],
  );

  return (
    <HeadingConnectionDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Connections for ${headingLabel}`}
      description="Connect this heading to graph nodes, table rows, or table columns in this note."
    >
      <div className="grid min-h-0 flex-1 grid-rows-[auto_auto_minmax(0,1fr)] gap-3 overflow-hidden p-4">
        <PanelTabs
          ariaLabel="Connection target type"
          value={category}
          onChange={(value) => setChosenCategory(value as TargetCategory)}
          items={[
            {
              id: "graph",
              label: "Graph",
              disabled: !availableCategories.includes("graph"),
            },
            {
              id: "table",
              label: "Table",
              disabled: !availableCategories.includes("table"),
            },
          ]}
        />
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder={`Search ${category} targets`}
          label={`Search ${category} targets`}
          autoFocus
        />
        <div className="min-h-0 overflow-y-auto" aria-label="Available connection targets">
          {visibleTargets.length > 0 ? (
            <div className="grid gap-1">
              {visibleTargets.map((target) => (
                <HeadingConnectionOption
                  key={target.id}
                  checked={target.headingBlockIds.includes(headingBlockId)}
                  disabled={
                    readOnly ||
                    (!target.headingBlockIds.includes(headingBlockId) &&
                      target.headingBlockIds.length >= MAX_NOTE_HEADING_CONNECTIONS_PER_TARGET)
                  }
                  label={target.title}
                  detail={`${headingTargetKindLabel(target.kind)} · ${target.tabTitle}`}
                  onToggle={() => onToggleTarget(target)}
                  onOpen={() => onOpenTarget(target)}
                />
              ))}
            </div>
          ) : (
            <HeadingConnectionListEmpty>
              {targets.length === 0
                ? "Add a graph node, table row, or table column first."
                : "No targets match this search."}
            </HeadingConnectionListEmpty>
          )}
        </div>
      </div>
    </HeadingConnectionDialog>
  );
}
