import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  CloudIcon,
  DatabaseIcon,
  DownloadIcon,
  LockIcon,
  MessageSquareIcon,
  SettingsIcon,
  ArrowLeftRightIcon,
  PaletteIcon,
  PlugZapIcon,
  PuzzleIcon,
} from "lucide-react";

import { ShortcutHint } from "../keyboard/ShortcutHint";
import { useShortcuts, type Shortcut } from "../keyboard/useShortcuts";
import { Button } from "../ui/Button";
import { cn } from "../ui/cn";
import { SearchField } from "../ui/SearchField";
import { SidebarRow, sidebarSearchClassName, sidebarSearchInputClassName } from "../ui/SidebarRow";

import { AppearanceSettings } from "./AppearanceSettings";
import { BackupSettings } from "./BackupSettings";
import { DataSettings } from "./DataSettings";
import { ImportExportSettings } from "./ImportExportSettings";
import { SecuritySettings } from "./SecuritySettings";
import { SettingsBusyProvider } from "./SettingsLayout";
import { SyncSettings } from "./SyncSettings";
import { UpdateSettings } from "./UpdateSettings";
import { McpSettings } from "./McpSettings";
import { AiChatSettings } from "./AiChatSettings";
import { PluginsSettings } from "./PluginsSettings";
import styles from "./settings.module.css";

type SettingsSectionDefinition = {
  id: string;
  label: string;
  group: "Library" | "Application";
  description: string;
  keywords: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  Content: ComponentType;
};

const SECTIONS: readonly SettingsSectionDefinition[] = [
  {
    id: "data",
    label: "Data",
    group: "Library",
    icon: DatabaseIcon,
    Content: DataSettings,
    description: "Where your notes are stored",
    keywords: "folder location storage sqlite database local files",
  },
  {
    id: "transfer",
    label: "Import & export",
    group: "Library",
    icon: ArrowLeftRightIcon,
    Content: ImportExportSettings,
    description: "Bring notes in or save them as files",
    keywords: "markdown obsidian evernote enex notion zip html web pages attachments",
  },
  {
    id: "backups",
    label: "Backups",
    group: "Library",
    icon: ArchiveIcon,
    Content: BackupSettings,
    description: "Back up your library or restore a copy",
    keywords: "daily automatic manual recovery history retention folder file",
  },
  {
    id: "sync",
    label: "Sync",
    group: "Library",
    icon: CloudIcon,
    Content: SyncSettings,
    description: "Keep notes in sync across computers",
    keywords: "cloud folder dropbox icloud onedrive syncthing devices passphrase",
  },
  {
    id: "appearance",
    label: "Appearance",
    group: "Application",
    icon: PaletteIcon,
    Content: AppearanceSettings,
    description: "Light or dark, colour themes, fonts and CSS snippets",
    keywords:
      "theme dark light mode colour color accent font nord solarized catppuccin rose pine css snippet style",
  },
  {
    id: "plugins",
    label: "Plugins",
    group: "Application",
    icon: PuzzleIcon,
    Content: PluginsSettings,
    description: "Add commands, buttons and panels",
    keywords: "plugin extension addon add-on community restricted mode permissions develop",
  },
  {
    id: "security",
    label: "Security",
    group: "Application",
    icon: LockIcon,
    Content: SecuritySettings,
    description: "Encryption, passphrase and recovery key",
    keywords: "password privacy lock protect encrypt",
  },
  {
    id: "mcp",
    label: "AI access",
    group: "Application",
    icon: PlugZapIcon,
    Content: McpSettings,
    description: "Connect an AI client to your notes",
    keywords: "mcp model context protocol server port endpoint http stdio token connection key",
  },
  {
    id: "ai-chat",
    label: "Side chat",
    group: "Application",
    icon: MessageSquareIcon,
    Content: AiChatSettings,
    description: "An AI assistant beside your notes",
    keywords: "ai assistant chat claude codex openai anthropic openrouter ollama model api key",
  },
  {
    id: "updates",
    label: "Updates",
    group: "Application",
    icon: DownloadIcon,
    Content: UpdateSettings,
    description: "App version and software updates",
    keywords: "about check download install restart",
  },
];

/** The settings sections another screen may open settings at. */
export type SettingsSectionId = "ai-chat";

/** A workspace screen. Editors stay mounted in the hidden notes workspace. */
export function SettingsScreen({
  open,
  section,
  onClose,
}: {
  open: boolean;
  /** The section to show when settings opens; the first one without it. */
  section?: SettingsSectionId;
  onClose: () => void;
}) {
  const [activeId, setActiveId] = useState(SECTIONS[0]!.id);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [resultIndex, setResultIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  const active = SECTIONS.find((section) => section.id === activeId) ?? SECTIONS[0]!;
  const searchQuery = query.trim().toLowerCase();
  const searching = searchQuery.length > 0;
  const results = useMemo(() => {
    if (!searchQuery) return [];
    const words = searchQuery.split(/\s+/);
    return SECTIONS.filter((section) => {
      const text = `${section.label} ${section.description} ${section.keywords}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
  }, [searchQuery]);
  const selectedResultIndex = Math.min(resultIndex, Math.max(0, results.length - 1));

  const focusSearch = useCallback(() => {
    searchRef.current?.focus();
    searchRef.current?.select();
  }, []);
  const clearSearch = useCallback(() => {
    setQuery("");
    setResultIndex(0);
  }, []);
  const selectSection = (id: string) => {
    if (busy) return;
    setActiveId(id);
    clearSearch();
    contentRef.current?.scrollTo?.({ top: 0 });
    contentRef.current?.focus({ preventScroll: true });
  };
  const shortcuts = useMemo(
    (): Shortcut[] => [
      { id: "entry.find", enabled: open && !busy, allowInEditable: true, run: focusSearch },
      {
        id: "entry.close",
        enabled: open && !busy,
        allowInEditable: true,
        run: () => {
          if (searching) {
            clearSearch();
            searchRef.current?.focus();
          } else onClose();
        },
      },
      { id: "entry.previous", enabled: open && !busy, allowInEditable: true, run: onClose },
    ],
    [open, busy, searching, onClose, focusSearch, clearSearch],
  );
  useShortcuts(shortcuts);

  useEffect(() => {
    if (!open) return;
    clearSearch();
    if (section) setActiveId(section);
    contentRef.current?.focus({ preventScroll: true });
  }, [open, section, clearSearch]);

  useEffect(() => {
    if (!open || !searching) return;
    document
      .getElementById(`settings-result-${results[selectedResultIndex]?.id}`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [open, searching, results, selectedResultIndex]);

  if (!open) return null;

  return (
    <div className={cn(styles.screen, "app-shell-theme")} data-testid="settings-screen">
      <aside className={cn("loam-sidebar", styles.nav)} aria-label="Settings navigation">
        <div className={cn("loam-chrome-row", styles.titlebar)}>
          <span className="loam-app-name">Loam</span>
        </div>
        <div className="loam-sidebar-body">
          <div className="loam-sidebar-header">
            <SearchField
              surface="plain"
              className={cn("min-w-0 flex-1", sidebarSearchClassName)}
              inputClassName={sidebarSearchInputClassName}
              id="settings-search-input"
              ref={searchRef}
              placeholder="Search settings"
              label="Search settings"
              clearLabel="Clear settings search"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={searching && results.length > 0}
              aria-controls={
                searching && results.length > 0 ? "settings-search-results" : undefined
              }
              aria-activedescendant={
                searching && results[selectedResultIndex]
                  ? `settings-result-${results[selectedResultIndex].id}`
                  : undefined
              }
              value={query}
              disabled={busy}
              exitOnCommitKeys={false}
              onChange={(value) => {
                setQuery(value);
                setResultIndex(0);
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || results.length === 0) return;
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setResultIndex(
                    (selectedResultIndex + (event.key === "ArrowDown" ? 1 : -1) + results.length) %
                      results.length,
                  );
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  selectSection(results[selectedResultIndex]!.id);
                }
              }}
            />
          </div>
          <div className={cn("loam-sidebar-tree", styles.navTree)}>
            {searching ? (
              results.length > 0 ? (
                <div
                  id="settings-search-results"
                  className={cn(styles.navGroup, styles.searchResults)}
                  role="listbox"
                  aria-label="Settings search results"
                >
                  {results.map(({ id, label, description, icon: Icon }, index) => (
                    <SidebarRow
                      key={id}
                      id={`settings-result-${id}`}
                      role="option"
                      tabIndex={-1}
                      aria-selected={index === selectedResultIndex}
                      isActive={index === selectedResultIndex}
                      disabled={busy}
                      className={cn("h-auto items-start", styles.navRow)}
                      onMouseMove={() => setResultIndex(index)}
                      onClick={() => selectSection(id)}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden />
                      <span className="min-w-0">
                        <span className="block">{label}</span>
                        <span className="mt-1 block text-xs leading-normal text-(--app-muted)">
                          {description}
                        </span>
                      </span>
                    </SidebarRow>
                  ))}
                </div>
              ) : (
                <p className="px-2 py-1.5 text-xs leading-normal text-(--app-muted)" role="status">
                  No settings found. Try “backup”, “password” or “MCP”.
                </p>
              )
            ) : (
              <nav className={styles.navGroups} aria-label="Settings sections">
                {(["Library", "Application"] as const).map((group) => (
                  <div className={styles.navGroup} key={group}>
                    {SECTIONS.filter((section) => section.group === group).map(
                      ({ id, label, icon: Icon }) => (
                        <SidebarRow
                          key={id}
                          isActive={id === active.id}
                          aria-current={id === active.id ? "page" : undefined}
                          className={styles.navRow}
                          disabled={busy}
                          onClick={() => selectSection(id)}
                        >
                          <Icon className="size-4 shrink-0" aria-hidden />
                          {label}
                        </SidebarRow>
                      ),
                    )}
                  </div>
                ))}
              </nav>
            )}
          </div>
          {busy ? (
            <p className="px-2 py-1.5 text-xs leading-normal text-(--app-muted)" role="status">
              Working… You can return to notes when this finishes.
            </p>
          ) : null}
        </div>
        <div className={styles.navFooter}>
          <SidebarRow disabled={busy} onClick={onClose}>
            <ArrowLeftIcon className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate">Back to notes</span>
            <kbd
              className={cn("font-[inherit] text-[11px] text-(--app-muted)", styles.navShortcut)}
            >
              Esc
            </kbd>
          </SidebarRow>
        </div>
      </aside>
      <div className={styles.main}>
        <header className={cn("loam-chrome-row", styles.header)}>
          <nav className={styles.breadcrumb} aria-label="Settings breadcrumb">
            <span>Settings</span>
            <span aria-hidden="true" className="text-(--app-muted)">
              /
            </span>
            <h1>{active.label}</h1>
          </nav>
        </header>
        <main ref={contentRef} className={styles.content} aria-label="Settings" tabIndex={-1}>
          <div className={styles.page}>
            <SettingsBusyProvider value={setBusy}>
              <active.Content />
            </SettingsBusyProvider>
          </div>
        </main>
      </div>
    </div>
  );
}

export function SettingsButton({ onOpen }: { onOpen: () => void }) {
  return (
    <ShortcutHint label="Settings" shortcut="app.settings">
      <Button variant="ghost" size="icon-sm" aria-label="Settings" onClick={onOpen}>
        <SettingsIcon className="size-4" aria-hidden="true" />
      </Button>
    </ShortcutHint>
  );
}
