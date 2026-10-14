import {
  isHexColor,
  isSafeFontFamily,
  type ThemeAppearance,
  type ThemeManifest,
  type ThemeMode,
  type ThemePalette,
  type ThemeTokens,
} from "./themeSchema";
import { FONT_TOKENS, THEME_TOKENS, type FontTokenName, type ThemeTokenName } from "./themeTokens";

const mix = (a: string, percent: number, b: string) => `color-mix(in srgb, ${a} ${percent}%, ${b})`;

const relativeLuminance = (hex: string) => {
  const digits = hex.slice(1);
  const full =
    digits.length <= 4
      ? [...digits.slice(0, 3)].map((digit) => digit + digit).join("")
      : digits.slice(0, 6);
  const channel = (offset: number) => {
    const value = parseInt(full.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
};

/** Near-black or near-white, whichever reads better on `hex`. */
export const readableOn = (hex: string) => (relativeLuminance(hex) > 0.4 ? "#141414" : "#fafafa");

/** Every token, derived from a theme's few base colours. */
export const tokensFromPalette = (palette: ThemePalette, mode: ThemeAppearance): ThemeTokens => {
  const { background: bg, surface, text, muted, border, accent } = palette;
  const dark = mode === "dark";
  return {
    page: bg,
    "page-2": mix(bg, 88, text),
    bg,
    surface,
    "surface-2": mix(surface, dark ? 92 : 96, text),
    "surface-overlay": dark ? mix(surface, 94, text) : surface,
    border,
    "border-subtle": mix(border, 60, bg),
    "border-strong": mix(border, 82, text),
    divider: mix(border, 60, "transparent"),
    input: mix(border, 88, text),
    text,
    muted,
    "icon-muted": muted,
    "secondary-label": mix(text, 72, bg),
    placeholder: mix(muted, 72, bg),
    accent,
    "accent-2": accent,
    "accent-foreground": palette.accentText ?? readableOn(accent),
    "accent-muted": mix(accent, dark ? 24 : 16, surface),
    "accent-muted-foreground": text,
    "code-bg": mix(surface, dark ? 92 : 96, text),
    "selection-bg": mix(accent, 28, "transparent"),
    "search-match-bg": mix(palette.warning ?? "#f5a524", dark ? 45 : 35, surface),
    "search-match-foreground": text,
    control: dark ? mix(surface, 94, text) : surface,
    "control-hover": mix(surface, dark ? 88 : 92, text),
    "sidebar-hover": mix(bg, 95, text),
    scrollbar: mix(text, 12, "transparent"),
    "scrollbar-hover": mix(text, 20, "transparent"),
    glow: mix(accent, 18, "transparent"),
    "focus-ring": mix(accent, 60, bg),
    ...(palette.success && { success: palette.success }),
    ...(palette.warning && { warning: palette.warning }),
    ...(palette.danger && { danger: palette.danger }),
    ...(palette.info && { info: palette.info }),
  };
};

export const resolveThemeMode = (mode: ThemeMode, appearance: ThemeAppearance): ThemeTokens => ({
  ...(mode.palette && tokensFromPalette(mode.palette, appearance)),
  ...mode.tokens,
});

export interface AppearanceOverrides {
  /** A hex accent laid over whichever theme is shown. */
  accent?: string;
  fonts?: Partial<Record<FontTokenName, string>>;
}

const declarations = (entries: [string, string][]) =>
  entries.map(([name, value]) => `${name}:${value};`).join("");

const tokenDeclarations = (tokens: ThemeTokens) =>
  Object.entries(tokens).flatMap(([name, value]) =>
    value ? [[THEME_TOKENS[name as ThemeTokenName], value] as [string, string]] : [],
  );

/**
 * The stylesheet that lays a theme over the default tokens. The selectors outrank app.css's
 * `:root` and `.dark`, so the order the sheets load in does not matter. A mode the theme
 * leaves out keeps Loam's own colours.
 */
export const compileThemeCss = (
  theme: ThemeManifest | null,
  overrides: AppearanceOverrides = {},
): string => {
  const accent =
    overrides.accent && isHexColor(overrides.accent)
      ? { accent: overrides.accent, "accent-2": overrides.accent }
      : {};
  const accentForeground =
    overrides.accent && isHexColor(overrides.accent)
      ? { "accent-foreground": readableOn(overrides.accent) }
      : {};
  const fonts = Object.entries(overrides.fonts ?? {}).flatMap(([name, value]) =>
    value?.trim() && isSafeFontFamily(value) && Object.hasOwn(FONT_TOKENS, name)
      ? [[FONT_TOKENS[name as FontTokenName], value.trim()] as [string, string]]
      : [],
  );
  const block = (selector: string, appearance: ThemeAppearance) => {
    const mode = theme?.[appearance];
    const tokens = {
      ...(mode && resolveThemeMode(mode, appearance)),
      ...accent,
      ...accentForeground,
    };
    const body = declarations(tokenDeclarations(tokens));
    return body ? `${selector}{${body}}` : "";
  };
  return [
    block(":root:not(.dark)", "light"),
    block(":root.dark", "dark"),
    fonts.length ? `:root:root{${declarations(fonts)}}` : "",
  ]
    .filter(Boolean)
    .join("\n");
};
