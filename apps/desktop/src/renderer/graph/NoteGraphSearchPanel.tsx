import type { RefObject } from "react";
import { ChevronDownIcon, FunnelIcon, SearchIcon, XIcon } from "lucide-react";

import { Button } from "../ui/Button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/DropdownMenu";
import { cn } from "../ui/cn";
import { dropdownTriggerClass } from "../styles/dropdowns";
import { Input } from "../ui/Input";
import { noteGraphColorHex, noteGraphNodeColors } from "@loam/shared/notes/noteGraphColors";

import { NoteGraphMenuTrigger } from "./NoteGraphMenuTrigger";
import type { NoteGraphFilter } from "./noteGraphQuery";
import { noteGraphShapeOptions } from "./noteGraphShapes";
import type { NoteGraphSearch } from "./useNoteGraphSearch";
import type { NoteGraphNodeColor } from "@loam/shared/notes/noteModel";

function NoteGraphColorFilter({
  value = [],
  onValueChange,
  disabled,
}: {
  value?: readonly NoteGraphNodeColor[];
  onValueChange: (colors: NoteGraphNodeColor[] | undefined) => void;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Filter graph colors"
          disabled={disabled}
          className={cn(dropdownTriggerClass, "w-36 pr-2 leading-4 text-(--app-text)")}
        >
          <span className={cn("min-w-0 truncate", value.length === 0 && "text-(--app-muted)")}>
            {value.length > 0 ? `${value.length} selected` : "All colors"}
          </span>
          <ChevronDownIcon className="size-3.5 shrink-0 text-(--app-muted)" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-72 w-(--radix-dropdown-menu-trigger-width) min-w-0"
      >
        {noteGraphNodeColors.map((color) => (
          <DropdownMenuCheckboxItem
            key={color}
            checked={value.includes(color)}
            onCheckedChange={(checked) => {
              const selected = noteGraphNodeColors.filter((entry) =>
                entry === color ? checked : value.includes(entry),
              );
              onValueChange(selected.length ? selected : undefined);
            }}
            onSelect={(event) => event.preventDefault()}
          >
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: noteGraphColorHex[color] }}
            />
            <span className="min-w-0 flex-1 truncate">
              {color[0]!.toUpperCase() + color.slice(1)}
            </span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type FilterFlag = "hasTimestamp" | "hasHeadings" | "orphansOnly";

const filterFlags: Array<{ key: FilterFlag; label: string }> = [
  { key: "hasTimestamp", label: "Has video timestamp" },
  { key: "hasHeadings", label: "Linked to headings" },
  { key: "orphansOnly", label: "Orphans (no connectors)" },
];

function NoteGraphFilters({
  filters,
  active,
  disabled,
  onChange,
}: {
  filters: NoteGraphFilter;
  active: boolean;
  disabled: boolean;
  onChange: (filters: NoteGraphFilter) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <NoteGraphColorFilter
        disabled={disabled}
        value={filters.colors}
        onValueChange={(colors) => onChange({ ...filters, colors })}
      />
      <DropdownMenu>
        <NoteGraphMenuTrigger
          aria-label="Filter nodes"
          disabled={disabled}
          title="Filter: dim nodes that do not match"
        >
          <FunnelIcon className="size-3.5 text-(--app-muted)" />
          {active ? "Filtered" : "Filter"}
        </NoteGraphMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Shape</DropdownMenuLabel>
          {noteGraphShapeOptions.map((shape) => (
            <DropdownMenuCheckboxItem
              checked={filters.shapes?.includes(shape.id) ?? false}
              key={shape.id}
              onCheckedChange={(checked) => {
                const current = filters.shapes ?? [];
                const shapes = checked
                  ? [...current, shape.id]
                  : current.filter((entry) => entry !== shape.id);
                onChange({ ...filters, shapes: shapes.length ? shapes : undefined });
              }}
            >
              {shape.label}
            </DropdownMenuCheckboxItem>
          ))}
          <DropdownMenuSeparator />
          {filterFlags.map((flag) => (
            <DropdownMenuCheckboxItem
              checked={filters[flag.key] ?? false}
              key={flag.key}
              onCheckedChange={(checked) =>
                onChange({ ...filters, [flag.key]: checked ? true : undefined })
              }
            >
              {flag.label}
            </DropdownMenuCheckboxItem>
          ))}
          {active ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onChange({})}>Clear filters</DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function NoteGraphSearchPanel({
  search,
  inputRef,
  nodeCount,
}: {
  search: NoteGraphSearch;
  inputRef: RefObject<HTMLInputElement | null>;
  nodeCount: number;
}) {
  const { matches, matchIndex, query } = search;
  return (
    <section
      aria-label="Find in graph"
      className="absolute left-3 top-3 z-30 w-80 max-w-[calc(100%-1.5rem)] rounded-md border border-(--app-border)/80 bg-(--app-page)/96 p-3 shadow-lg backdrop-blur"
      role="search"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-(--app-text)">Find in graph</p>
        <Button
          aria-label="Close find in graph"
          onClick={search.closeSearch}
          size="icon-xs"
          title="Close find and clear filters (Escape)"
          variant="ghost-muted"
        >
          <XIcon className="size-4" />
        </Button>
      </div>
      <div className="relative mb-2">
        <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-(--app-muted)" />
        <Input
          aria-label="Search nodes (Ctrl+F, Enter jumps)"
          className="h-8 w-full border-(--app-border)/70 bg-(--card-bg)/90 pl-7 pr-12 text-xs"
          onChange={(event) => search.setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              search.closeSearch();
            }
            if (event.key === "Enter") {
              event.preventDefault();
              search.cycleMatch(event.shiftKey ? -1 : 1);
            }
          }}
          placeholder="Search nodes"
          ref={inputRef}
          value={query}
        />
        {query.trim() ? (
          <span
            aria-live="polite"
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] tabular-nums text-(--app-muted)"
          >
            {matches.length === 0 ? "0" : `${(matchIndex % matches.length) + 1}/${matches.length}`}
          </span>
        ) : null}
      </div>
      <NoteGraphFilters
        active={search.filtersActive}
        disabled={nodeCount === 0}
        filters={search.filters}
        onChange={search.setFilters}
      />
    </section>
  );
}
