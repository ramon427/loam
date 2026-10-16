import { useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import { CheckIcon, RotateCcwIcon } from "lucide-react";

import { resolveThemeMode } from "@loam/shared/themes/themeCss";
import { isSafeFontFamily, themeModes, type ThemeManifest } from "@loam/shared/themes/themeSchema";
import { THEME_TOKENS, type ThemeTokenName } from "@loam/shared/themes/themeTokens";

import {
  chooseThemeChoice,
  readThemeChoice,
  resolveTheme,
  subscribeToThemeChanges,
  type AppTheme,
  type ThemeChoice,
} from "../lib/theme";
import {
  availableThemes,
  readAppearance,
  subscribeToAppearance,
  supportsFullGlass,
  updateAppearance,
  type Appearance,
} from "../themes/appearance";
import { DEFAULT_THEME_ID } from "../themes/presets";
import { Button } from "../ui/Button";
import { cn } from "../ui/cn";
import { Input } from "../ui/Input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/Select";

import { CustomizationFiles } from "./CustomizationFiles";
import { SettingsRow, SettingsSection } from "./SettingsLayout";

const useAppearance = () => {
  const [appearance, setAppearance] = useState(readAppearance);
  useEffect(() => subscribeToAppearance(() => setAppearance(readAppearance())), []);
  return appearance;
};

const useShownTheme = () => useSyncExternalStore(subscribeToThemeChanges, resolveTheme);

const CHOICES: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** The tokens a preview card paints with, so each card shows its own theme in place. */
const previewStyle = (theme: ThemeManifest, mode: AppTheme): CSSProperties => {
  const themeMode = theme[mode];
  if (!themeMode) return {};
  const tokens = resolveThemeMode(themeMode, mode);
  return Object.fromEntries(
    Object.entries(tokens).map(([name, value]) => [THEME_TOKENS[name as ThemeTokenName], value]),
  ) as CSSProperties;
};

function ThemeCard({
  theme,
  shown,
  selected,
  onSelect,
}: {
  theme: ThemeManifest;
  shown: AppTheme;
  selected: boolean;
  onSelect: () => void;
}) {
  const modes = themeModes(theme);
  // A theme without the window's mode is previewed in the mode it has.
  const mode = modes.includes(shown) ? shown : modes[0]!;
  const only = modes.length === 1 ? `${modes[0] === "light" ? "Light" : "Dark"} only` : null;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-testid={`theme-card-${theme.id}`}
      onClick={onSelect}
      className={cn(
        "group flex flex-col gap-2 rounded-(--radius-control) p-1.5 text-left outline-offset-2",
        "hover:bg-(--app-control-hover)",
        selected && "bg-(--app-control-hover)",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "loam-tokens relative flex h-20 w-full overflow-hidden rounded-[6px] border border-(--app-border)",
          mode === "dark" && "dark",
          selected && "ring-2 ring-(--app-accent) ring-offset-1 ring-offset-(--app-surface)",
        )}
        style={previewStyle(theme, mode)}
      >
        <span className="flex w-1/3 flex-col gap-1 bg-(--app-bg) p-1.5">
          <span className="h-1.5 w-3/4 rounded-full bg-(--app-muted) opacity-60" />
          <span className="h-1.5 w-1/2 rounded-full bg-(--app-muted) opacity-40" />
          <span className="h-1.5 w-2/3 rounded-full bg-(--app-muted) opacity-40" />
        </span>
        <span className="flex flex-1 flex-col gap-1 bg-(--app-surface) p-2">
          <span className="h-2 w-2/3 rounded-full bg-(--app-text)" />
          <span className="h-1.5 w-full rounded-full bg-(--app-muted) opacity-50" />
          <span className="h-1.5 w-5/6 rounded-full bg-(--app-muted) opacity-50" />
          <span className="mt-auto h-3 w-8 self-end rounded-[3px] bg-(--app-accent)" />
        </span>
        {selected ? (
          <CheckIcon className="absolute top-1 right-1 size-3.5 rounded-full bg-(--app-accent) p-0.5 text-(--app-accent-foreground)" />
        ) : null}
      </span>
      <span className="flex min-w-0 items-baseline justify-between gap-2 px-0.5 text-xs">
        <span className="truncate font-medium text-(--app-text)">{theme.name}</span>
        {only ? <span className="shrink-0 text-(--app-muted)">{only}</span> : null}
      </span>
    </button>
  );
}

function FontField({
  label,
  name,
  appearance,
}: {
  label: string;
  name: "ui" | "code";
  appearance: Appearance;
}) {
  const saved = appearance.fonts?.[name] ?? "";
  const [draft, setDraft] = useState(saved);
  useEffect(() => setDraft(saved), [saved]);
  const valid = !draft.trim() || isSafeFontFamily(draft);
  const commit = () => {
    if (!valid || draft === saved) return;
    const fonts = { ...appearance.fonts, [name]: draft.trim() || undefined };
    if (name === "ui") fonts.body = undefined;
    updateAppearance({ fonts });
  };
  return (
    <Input
      aria-label={label}
      aria-invalid={!valid}
      className="w-56"
      placeholder="Default"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
    />
  );
}

/** Light or dark, the colour theme, and the accent and fonts laid over it. */
export function AppearanceSettings() {
  const appearance = useAppearance();
  const shown = useShownTheme();
  const [choice, setChoice] = useState(readThemeChoice);
  const themes = availableThemes();
  const selectedId = themes.some((theme) => theme.id === appearance.themeId)
    ? appearance.themeId
    : DEFAULT_THEME_ID;

  return (
    <>
      <SettingsSection description="Pick how Loam looks. Themes change colours only; CSS snippets below can change more.">
        <SettingsRow
          title="Mode"
          description="System follows your computer's light or dark setting."
          control={
            <Select
              value={choice}
              onValueChange={(value) => {
                const next = value as ThemeChoice;
                setChoice(next);
                chooseThemeChoice(next);
              }}
            >
              <SelectTrigger aria-label="Mode" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHOICES.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <SettingsRow
          title="Glass"
          description={
            supportsFullGlass()
              ? "Whole window lets your desktop show through Loam."
              : "Whole window needs macOS or Windows 11."
          }
          control={
            <Select
              value={appearance.glass ?? "floating"}
              disabled={!supportsFullGlass()}
              onValueChange={(value) =>
                updateAppearance({ glass: value === "full" ? "full" : undefined })
              }
            >
              <SelectTrigger aria-label="Glass" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="floating">Menus and bars</SelectItem>
                <SelectItem value="full">Whole window</SelectItem>
              </SelectContent>
            </Select>
          }
        />
        <SettingsRow title="Theme">
          <div
            role="radiogroup"
            aria-label="Theme"
            className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2"
          >
            {themes.map((theme) => (
              <ThemeCard
                key={theme.id}
                theme={theme}
                shown={shown}
                selected={theme.id === selectedId}
                onSelect={() => updateAppearance({ themeId: theme.id })}
              />
            ))}
          </div>
        </SettingsRow>
        <SettingsRow
          title="Accent colour"
          description="Buttons, links and selection, over any theme."
          control={
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label="Accent colour"
                className="h-8 w-10 cursor-pointer rounded-(--radius-control) border border-(--control-border) bg-transparent p-0.5"
                value={appearance.accent ?? "#0a84ff"}
                onChange={(event) => updateAppearance({ accent: event.target.value })}
              />
              {appearance.accent ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => updateAppearance({ accent: undefined })}
                >
                  <RotateCcwIcon className="size-3.5" aria-hidden />
                  Theme's own
                </Button>
              ) : null}
            </div>
          }
        />
        <SettingsRow
          title="Interface font"
          description="Inter, or a font installed on this computer. Notes use it too."
          control={<FontField label="Interface font" name="ui" appearance={appearance} />}
        />
        <SettingsRow
          title="Code font"
          description="For code blocks and inline code."
          control={<FontField label="Code font" name="code" appearance={appearance} />}
        />
      </SettingsSection>
      <CustomizationFiles />
    </>
  );
}
