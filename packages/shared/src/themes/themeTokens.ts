/**
 * The colour tokens a theme may set, by the short name a theme file uses. Each maps to one
 * custom property in the renderer's styles/app.css; every other colour there derives from these.
 */
export const THEME_TOKENS = {
  page: "--app-page",
  "page-2": "--app-page-2",
  bg: "--app-bg",
  surface: "--app-surface",
  "surface-2": "--app-surface-2",
  "surface-overlay": "--app-surface-overlay",
  border: "--app-border",
  "border-subtle": "--app-border-subtle",
  "border-strong": "--app-border-strong",
  divider: "--app-divider",
  input: "--app-input",
  text: "--app-text",
  muted: "--app-muted",
  "icon-muted": "--app-icon-muted",
  "secondary-label": "--app-secondary-label",
  placeholder: "--app-placeholder",
  accent: "--app-accent",
  "accent-2": "--app-accent-2",
  "accent-foreground": "--app-accent-foreground",
  "accent-muted": "--app-accent-muted",
  "accent-muted-foreground": "--app-accent-muted-foreground",
  "code-bg": "--app-code-bg",
  "selection-bg": "--app-selection-bg",
  "search-match-bg": "--app-search-match-bg",
  "search-match-foreground": "--app-search-match-foreground",
  control: "--app-control",
  "control-hover": "--app-control-hover",
  "sidebar-hover": "--app-sidebar-hover",
  scrollbar: "--app-scrollbar",
  "scrollbar-hover": "--app-scrollbar-hover",
  glow: "--app-glow",
  "focus-ring": "--app-focus-ring",
  success: "--status-success",
  warning: "--status-warning",
  danger: "--status-danger",
  info: "--status-info",
} as const;

export type ThemeTokenName = keyof typeof THEME_TOKENS;

export const THEME_TOKEN_NAMES = Object.keys(THEME_TOKENS) as ThemeTokenName[];

/** The font tokens the Appearance settings may set. */
export const FONT_TOKENS = {
  ui: "--font-ui",
  body: "--font-body",
  code: "--font-code",
} as const;

export type FontTokenName = keyof typeof FONT_TOKENS;
