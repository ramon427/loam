import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PanelRightCloseIcon,
  PanelRightIcon,
  PencilIcon,
  PlusIcon,
  Repeat2Icon,
  Trash2Icon,
} from "lucide-react";

import {
  ActionMenuContent,
  ActionMenuItem,
  ActionMenuSub,
  isActionMenuTarget,
  leaveToNativeMenu,
} from "../action-menu/ActionMenu";
import { useNativeSortableList } from "../lib/nativeSortable";
import { Button } from "../ui/Button";
import { cn } from "../ui/cn";
import { ContextMenu, ContextMenuSeparator, ContextMenuTrigger } from "../ui/ContextMenu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "../ui/Dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/DropdownMenu";
import { Input } from "../ui/Input";
import { Label } from "../ui/Label";
import { CONTROL_TRANSITION_TIMING_CLASS, FOCUS_RING_CLASS } from "../styles/controlInteraction";
import type { NoteDocument } from "../workspace/types";
import {
  isFileTabKind,
  tabKindOf,
  tabTitleOf,
  type ConvertibleTabKind,
  type NoteTab,
  type NoteTabKind,
} from "@loam/shared/notes/noteModel";

import page from "./notePage.module.css";
import { describeTabRemoval, MAX_TAB_TITLE_LENGTH, MAX_TABS, tabHasContent } from "./noteTabs";
import { describeConversion } from "./tabConversions";
import {
  CHANGE_TYPE_KINDS,
  TAB_KIND_GROUPS,
  TAB_KIND_ORDER,
  TAB_KINDS,
  TabKindIcon,
} from "./tabKinds";

type Half = "before" | "after";

/** The dialog a tab action is waiting on, if any. */
type TabDialog =
  | { action: "rename"; tab: NoteTab }
  | { action: "delete"; tab: NoteTab }
  | { action: "change-kind"; tab: NoteTab; kind: ConvertibleTabKind };

const kindLabel = (kind: NoteTabKind) => TAB_KINDS[kind].label;

/**
 * The open note's tabs: select, drag to reorder, add one of a kind, and each
 * tab's right-click menu (move, rename, delete, change kind). Actions that
 * lose content or reorder ask first. `trailing` stands at the strip's far end, such as the note's
 * video tab.
 */
export function TabStrip({
  note,
  activeTabId,
  onSelect,
  onAdd,
  onRename,
  onDelete,
  onChangeKind,
  onMove,
  besideTabId = null,
  onShowBeside,
  trailing,
}: {
  note: NoteDocument;
  activeTabId: string;
  /** The file tab shown beside the note, if one is. */
  besideTabId?: string | null;
  /** Shows a file tab beside the note, or (with null) stops showing one there. */
  onShowBeside?: (tabId: string | null) => void;
  onSelect: (tabId: string) => void;
  onAdd: (kind: NoteTabKind) => void;
  onRename: (tabId: string, title: string) => void;
  onDelete: (tabId: string) => void;
  onChangeKind: (tabId: string, kind: ConvertibleTabKind) => void;
  onMove: (tabId: string, targetId: string, half: Half) => void;
  trailing?: ReactNode;
}) {
  const { tabs } = note;
  const [dialog, setDialog] = useState<TabDialog | null>(null);
  const [menuTab, setMenuTab] = useState<NoteTab | null>(null);
  const canAdd = tabs.length < MAX_TABS;
  const canReorder = tabs.length > 1;
  const sortable = useNativeSortableList({
    axis: "horizontal",
    instanceId: "note-tabs",
    disabled: !canReorder,
    onMove: ({ sourceId, targetId, half }) => {
      if (sourceId === targetId) return false;
      onMove(sourceId, targetId, half);
    },
  });

  // Paint the chosen tab before the editor swaps its content. The swap runs
  // after that frame, and rapid clicks only swap to the last choice.
  const [chosenTabId, setChosenTabId] = useState<string | null>(null);
  const pendingSelect = useRef<{ frame: number; timeout: number } | null>(null);
  const latest = useRef({ onSelect, tabs });
  useEffect(() => {
    latest.current = { onSelect, tabs };
  });
  const cancelPendingSelect = () => {
    if (!pendingSelect.current) return;
    cancelAnimationFrame(pendingSelect.current.frame);
    clearTimeout(pendingSelect.current.timeout);
    pendingSelect.current = null;
  };
  const cancelOnUnmount = useRef(cancelPendingSelect);
  useEffect(() => () => cancelOnUnmount.current(), []);
  const select = (tabId: string) => {
    cancelPendingSelect();
    if (tabId === activeTabId) {
      setChosenTabId(null);
      onSelect(tabId);
      return;
    }
    setChosenTabId(tabId);
    const frame = requestAnimationFrame(() => {
      const timeout = window.setTimeout(() => {
        pendingSelect.current = null;
        setChosenTabId(null);
        if (latest.current.tabs.some((tab) => tab.id === tabId)) latest.current.onSelect(tabId);
      }, 0);
      pendingSelect.current = { frame: 0, timeout };
    });
    pendingSelect.current = { frame, timeout: 0 };
  };
  const shownTabId = chosenTabId ?? activeTabId;

  // Only what loses content asks first; a move, or a change to an empty tab, happens at once.
  const requestKindChange = (tab: NoteTab, kind: ConvertibleTabKind) => {
    if (tabKindOf(tab) === kind) return;
    if (tabHasContent(note, tab)) setDialog({ action: "change-kind", tab, kind });
    else onChangeKind(tab.id, kind);
  };
  const requestDelete = (tab: NoteTab) => {
    if (tabHasContent(note, tab)) setDialog({ action: "delete", tab });
    else onDelete(tab.id);
  };

  // A tab's menu acts on that tab; the strip around the tabs only adds tabs.
  const handleContextMenuCapture = (event: ReactMouseEvent) => {
    const tabId =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-note-tab-id]")?.dataset.noteTabId
        : undefined;
    const tab = tabs.find((candidate) => candidate.id === tabId);
    if (!isActionMenuTarget(event) || (tabId && !tab)) {
      leaveToNativeMenu(event);
      return;
    }
    setMenuTab(tab ?? null);
  };

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const overflow = useTabOverflow(scrollRef, tabs);

  return (
    <div data-note-tab-strip className="flex min-w-0 w-full items-center justify-start gap-2">
      <div className="relative flex min-h-7 min-w-0 flex-1 items-center overflow-hidden">
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              ref={scrollRef}
              data-note-tab-scroll
              onContextMenuCapture={handleContextMenuCapture}
              className={cn(
                "flex min-h-8 min-w-0 w-full flex-nowrap items-end justify-start gap-1 overflow-x-auto overflow-y-hidden px-0",
                page.tabsScroll,
              )}
            >
              {tabs.map((tab) => (
                <TabButton
                  key={tab.id}
                  tab={tab}
                  active={tab.id === shownTabId}
                  beside={tab.id === besideTabId}
                  canDrag={canReorder}
                  dragProps={sortable.itemProps(tab.id, canReorder)}
                  onSelect={select}
                />
              ))}
              <div className="inline-flex shrink-0">
                <AddTabMenu disabled={!canAdd} onAdd={onAdd} />
              </div>
            </div>
          </ContextMenuTrigger>
          <ActionMenuContent aria-label="Tab actions">
            <TabMenuItems
              tabs={tabs}
              tab={menuTab}
              canAdd={canAdd}
              onAdd={onAdd}
              onRename={(tab) => setDialog({ action: "rename", tab })}
              onMove={onMove}
              onChangeKind={requestKindChange}
              onDelete={requestDelete}
              besideTabId={besideTabId}
              onShowBeside={onShowBeside}
            />
          </ActionMenuContent>
        </ContextMenu>
        <ScrollButton side="left" visible={overflow.left} scrollRef={scrollRef} />
        <ScrollButton side="right" visible={overflow.right} scrollRef={scrollRef} />
      </div>
      {trailing}

      {dialog?.action === "rename" ? (
        <RenameTabDialog
          tab={dialog.tab}
          onRename={(title) => {
            onRename(dialog.tab.id, title);
            setDialog(null);
          }}
          onCancel={() => setDialog(null)}
        />
      ) : null}
      {dialog?.action === "delete" ? (
        <ConfirmDialog
          title="Delete editor tab?"
          cancelLabel="Keep tab"
          confirmLabel="Delete editor tab"
          destructive
          onConfirm={() => {
            onDelete(dialog.tab.id);
            setDialog(null);
          }}
          onCancel={() => setDialog(null)}
        >
          <p>
            This removes &quot;{tabTitleOf(dialog.tab)}&quot; from the current note. Content saved
            under this tab will be deleted.
          </p>
          <RemovalImpact note={note} tab={dialog.tab} />
        </ConfirmDialog>
      ) : null}
      {dialog?.action === "change-kind" ? (
        <ConfirmDialog
          title={`Convert to a ${kindLabel(dialog.kind).toLowerCase()} tab?`}
          cancelLabel="Keep tab"
          confirmLabel={`Convert to ${kindLabel(dialog.kind).toLowerCase()} tab`}
          onConfirm={() => {
            onChangeKind(dialog.tab.id, dialog.kind);
            setDialog(null);
          }}
          onCancel={() => setDialog(null)}
        >
          <p>{describeConversion(tabKindOf(dialog.tab), dialog.kind)}</p>
          <RemovalImpact note={note} tab={dialog.tab} />
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

/** Whether the tab row can scroll further left or right, kept current as it scrolls or resizes. */
function useTabOverflow(scrollRef: { current: HTMLDivElement | null }, tabs: readonly NoteTab[]) {
  const [overflow, setOverflow] = useState({ left: false, right: false });
  useEffect(() => {
    const row = scrollRef.current;
    if (!row) return;
    const measure = () => {
      const scrolls = row.scrollWidth > row.clientWidth + 1;
      setOverflow({
        left: scrolls && row.scrollLeft > 1,
        right: scrolls && row.scrollLeft + row.clientWidth < row.scrollWidth - 1,
      });
    };
    measure();
    row.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => {
      row.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      observer.disconnect();
    };
  }, [scrollRef, tabs]);
  return overflow;
}

function ScrollButton({
  side,
  visible,
  scrollRef,
}: {
  side: "left" | "right";
  visible: boolean;
  scrollRef: { current: HTMLDivElement | null };
}) {
  const Icon = side === "left" ? ChevronLeftIcon : ChevronRightIcon;
  return (
    <>
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 w-16 bg-(--app-page) backdrop-blur-[1px] transition-opacity duration-200 motion-reduce:transition-none",
          side === "left" ? "left-0" : "right-0",
        )}
        style={{
          maskImage: `linear-gradient(to ${side === "left" ? "right" : "left"}, black, transparent)`,
          opacity: visible ? 1 : 0,
        }}
      />
      {visible ? (
        <Button
          variant="secondary"
          size="icon-xs"
          type="button"
          aria-label={`Scroll tabs ${side}`}
          className={cn(
            "absolute top-1/2 z-10 -translate-y-1/2 active:translate-y-[-50%]",
            side === "left" ? "left-1" : "right-1",
          )}
          onClick={() =>
            scrollRef.current?.scrollBy({ left: side === "left" ? -140 : 140, behavior: "smooth" })
          }
        >
          <Icon className="size-3.5" />
        </Button>
      ) : null}
    </>
  );
}

/**
 * A tab standing on the paper's top edge, in the colors the paper sets
 * (`--note-tab-surface`, `--note-tab-edge`): the shown tab is cut from the
 * paper and covers its edge; the others stand behind it.
 */
export const folderTabClass = cn(
  "relative inline-flex h-8 min-w-[108px] max-w-[180px] shrink-0 touch-manipulation items-center justify-start rounded-t-lg border border-(--note-tab-edge) px-3 text-left text-[12px] font-medium transition-[color,background-color] motion-reduce:transition-none",
  CONTROL_TRANSITION_TIMING_CLASS,
  FOCUS_RING_CLASS,
);

/** A folder tab's colors: the shown one is cut from the paper, the others stand behind it. */
export const folderTabColorClass = (active: boolean) =>
  active
    ? "z-1 border-b-(--note-tab-surface) bg-(--note-tab-surface) text-(--app-text)"
    : "bg-[color-mix(in_srgb,var(--note-tab-surface)_45%,var(--app-page))] text-(--app-muted) hover:bg-[color-mix(in_srgb,var(--note-tab-surface)_75%,var(--app-page))] hover:text-(--app-text)";

function TabButton({
  tab,
  active,
  beside,
  canDrag,
  dragProps,
  onSelect,
}: {
  tab: NoteTab;
  active: boolean;
  beside: boolean;
  canDrag: boolean;
  dragProps: ReturnType<ReturnType<typeof useNativeSortableList>["itemProps"]>;
  onSelect: (tabId: string) => void;
}) {
  const title = tabTitleOf(tab);
  return (
    <button
      type="button"
      onClick={() => onSelect(tab.id)}
      onKeyDown={(event) => {
        // The keyboard's menu key opens the tab's right-click menu.
        if (!(event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey))) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        event.currentTarget.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: rect.left,
            clientY: rect.bottom,
          }),
        );
      }}
      title={title}
      aria-pressed={active}
      data-note-tab-id={tab.id}
      data-drop-marker={dragProps["data-drop-marker"]}
      data-native-sortable-axis={dragProps["data-native-sortable-axis"]}
      draggable={dragProps.draggable}
      onDragStart={dragProps.onDragStart}
      onDragOver={dragProps.onDragOver}
      onDrop={dragProps.onDrop}
      onDragEnd={dragProps.onDragEnd}
      className={cn(
        folderTabClass,
        canDrag && "cursor-grab active:cursor-grabbing",
        dragProps.className,
        folderTabColorClass(active),
      )}
    >
      <span className="mr-1.5 inline-flex size-3.5 shrink-0 items-center justify-center text-current/80">
        <TabKindIcon kind={tabKindOf(tab)} />
      </span>
      <span className="block w-full truncate text-left">{title}</span>
      {beside ? (
        <span className="ml-1 inline-flex shrink-0 text-current/70">
          <PanelRightIcon aria-hidden="true" className="size-3.5" />
          <span className="sr-only">, beside the note</span>
        </span>
      ) : null}
    </button>
  );
}

/** The add-tab menu: kinds grouped by what they are for; number keys pick one. */
function AddTabMenu({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (kind: NoteTabKind) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost-muted"
          size="icon-sm"
          className="size-7 shrink-0 rounded-md border-0 bg-transparent text-(--app-muted)/60 shadow-none transition-[color,background-color,opacity] duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-(--app-page-2)/60 hover:text-(--app-text) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--focus-ring)"
          disabled={disabled}
          aria-label="Add tab"
        >
          <PlusIcon className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="bottom"
        className="min-w-60"
        onKeyDown={(event) => {
          const kind = TAB_KIND_ORDER[Number(event.key) - 1];
          if (!kind || event.ctrlKey || event.metaKey || event.altKey) return;
          event.preventDefault();
          setOpen(false);
          onAdd(kind);
        }}
      >
        {TAB_KIND_GROUPS.map(({ group, kinds }, index) => (
          <Fragment key={group}>
            {index > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel>{group}</DropdownMenuLabel>
            {kinds.map((kind) => (
              <DropdownMenuItem
                key={kind}
                aria-label={`${kindLabel(kind)} tab`}
                className="items-start"
                onSelect={() => onAdd(kind)}
              >
                <span className="mt-0.5">
                  <TabKindIcon kind={kind} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span>{TAB_KINDS[kind].label}</span>
                  <span className="text-[11px] text-(--app-muted)">
                    {TAB_KINDS[kind].description}
                  </span>
                </span>
                <kbd className="ml-3 font-sans text-[11px] text-(--app-muted)">
                  {TAB_KIND_ORDER.indexOf(kind) + 1}
                </kbd>
              </DropdownMenuItem>
            ))}
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The tab strip's right-click menu, for `tab` or (when null) for the strip around the tabs. */
function TabMenuItems({
  tabs,
  tab,
  canAdd,
  onAdd,
  onRename,
  onMove,
  onChangeKind,
  onDelete,
  besideTabId,
  onShowBeside,
}: {
  tabs: readonly NoteTab[];
  tab: NoteTab | null;
  besideTabId: string | null;
  onShowBeside?: (tabId: string | null) => void;
  canAdd: boolean;
  onAdd: (kind: NoteTabKind) => void;
  onRename: (tab: NoteTab) => void;
  onMove: (tabId: string, targetId: string, half: Half) => void;
  onChangeKind: (tab: NoteTab, kind: ConvertibleTabKind) => void;
  onDelete: (tab: NoteTab) => void;
}) {
  if (!tab) {
    return TAB_KIND_ORDER.map((kind) => (
      <ActionMenuItem
        key={kind}
        icon={<TabKindIcon kind={kind} />}
        disabled={!canAdd}
        onSelect={() => onAdd(kind)}
      >
        Add {kindLabel(kind).toLowerCase()} tab
      </ActionMenuItem>
    ));
  }

  const index = tabs.findIndex((candidate) => candidate.id === tab.id);
  return (
    <>
      <ActionMenuItem icon={<PencilIcon aria-hidden="true" />} onSelect={() => onRename(tab)}>
        Rename tab…
      </ActionMenuItem>
      {([-1, 1] as const).map((direction) => {
        const neighbor = tabs[index + direction];
        return (
          <ActionMenuItem
            key={direction}
            icon={
              direction < 0 ? (
                <ArrowLeftIcon aria-hidden="true" />
              ) : (
                <ArrowRightIcon aria-hidden="true" />
              )
            }
            disabled={!neighbor}
            onSelect={() => {
              if (neighbor) onMove(tab.id, neighbor.id, direction < 0 ? "before" : "after");
            }}
          >
            {direction < 0 ? "Move left" : "Move right"}
          </ActionMenuItem>
        );
      })}
      {onShowBeside && isFileTabKind(tabKindOf(tab)) ? (
        tab.id === besideTabId ? (
          <ActionMenuItem
            icon={<PanelRightCloseIcon aria-hidden="true" />}
            onSelect={() => onShowBeside(null)}
          >
            Stop showing beside the note
          </ActionMenuItem>
        ) : (
          <ActionMenuItem
            icon={<PanelRightIcon aria-hidden="true" />}
            disabled={tabs.length <= 1}
            onSelect={() => onShowBeside(tab.id)}
          >
            Show beside the note
          </ActionMenuItem>
        )
      ) : null}
      {isFileTabKind(tabKindOf(tab)) ? null : (
        <ActionMenuSub label="Change type" icon={<Repeat2Icon aria-hidden="true" />}>
          {CHANGE_TYPE_KINDS.map((kind) => (
            <ActionMenuItem
              key={kind}
              icon={<TabKindIcon kind={kind} />}
              disabled={tabKindOf(tab) === kind}
              onSelect={() => onChangeKind(tab, kind)}
            >
              {kindLabel(kind)}
            </ActionMenuItem>
          ))}
        </ActionMenuSub>
      )}
      <ContextMenuSeparator />
      <ActionMenuItem
        icon={<Trash2Icon aria-hidden="true" />}
        destructive
        disabled={tabs.length <= 1}
        onSelect={() => onDelete(tab)}
      >
        Delete tab
      </ActionMenuItem>
    </>
  );
}

function RemovalImpact({ note, tab }: { note: NoteDocument; tab: NoteTab }) {
  const impact = describeTabRemoval(note, tab);
  return impact ? <p>{impact}</p> : null;
}

function RenameTabDialog({
  tab,
  onRename,
  onCancel,
}: {
  tab: NoteTab;
  onRename: (title: string) => void;
  onCancel: () => void;
}) {
  const inputId = useId();
  const [title, setTitle] = useState(tabTitleOf(tab));
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onCancel())}>
      <DialogContent className="max-w-[420px]" showCloseButton={false}>
        <DialogTitle>Rename editor tab?</DialogTitle>
        <DialogDescription className="text-xs text-(--app-muted)">
          This changes the tab name for the current note.
        </DialogDescription>
        <div className="space-y-2">
          <Label htmlFor={inputId} className="text-xs font-medium text-(--app-muted)">
            Tab name
          </Label>
          <Input
            id={inputId}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={MAX_TAB_TITLE_LENGTH}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Keep name
          </Button>
          <Button type="button" size="sm" onClick={() => onRename(title)}>
            Rename tab
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmDialog({
  title,
  cancelLabel,
  confirmLabel,
  destructive = false,
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  cancelLabel: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onCancel())}>
      <DialogContent className="max-w-[420px]" showCloseButton={false}>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription asChild className="text-xs text-(--app-muted)">
          <div className="space-y-2">{children}</div>
        </DialogDescription>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            size="sm"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
