import { compileThemeCss, type AppearanceOverrides } from "@loam/shared/themes/themeCss";
import { isHexColor, type ThemeManifest } from "@loam/shared/themes/themeSchema";

import { isRecord } from "@loam/shared/utils/isRecord";

import { readPreference, writePreference } from "../lib/preferences";

import { DEFAULT_THEME_ID, THEME_PRESETS } from "./presets";

/*
 * The theme laid over the default tokens, the accent and fonts chosen over it, and the CSS
 * snippets switched on. The compiled sheets are cached under fixed keys so public/theme-init.js
 * can put them in place before the first paint.
 */

/** Read by public/theme-init.js; keep the names in step. */
const THEME_CSS_KEY = "loam:theme-css";
const SNIPPETS_CSS_KEY = "loam:snippets-css";
const THEME_STYLE_ID = "loam-theme";
const SNIPPETS_STYLE_ID = "loam-snippets";

const APPEARANCE_KEY = "appearance";

export interface Appearance extends AppearanceOverrides {
  themeId: string;
}

const DEFAULT_APPEARANCE: Appearance = { themeId: DEFAULT_THEME_ID };

const readFonts = (value: unknown): Appearance["fonts"] => {
  if (!isRecord(value)) return undefined;
  const fonts: NonNullable<Appearance["fonts"]> = {};
  for (const name of ["ui", "body", "code"] as const) {
    const font = value[name];
    if (typeof font === "string" && font.trim()) fonts[name] = font;
  }
  return Object.keys(fonts).length ? fonts : undefined;
};

const readAppearanceValue = (value: unknown): Appearance | null => {
  if (!isRecord(value) || typeof value.themeId !== "string") return null;
  return {
    themeId: value.themeId,
    ...(typeof value.accent === "string" && isHexColor(value.accent) && { accent: value.accent }),
    ...(readFonts(value.fonts) && { fonts: readFonts(value.fonts) }),
  };
};

export const readAppearance = (): Appearance =>
  readPreference(APPEARANCE_KEY, readAppearanceValue) ?? DEFAULT_APPEARANCE;

const readCache = (key: string) => {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
};

let customThemes: readonly ThemeManifest[] = [];
/** False until the library's theme files have been read; a custom theme saved by id waits on it. */
let customThemesLoaded = false;
/** Starts as last session's snippets, so they stay in place until the library's are read. */
let snippetsCss = readCache(SNIPPETS_CSS_KEY);

/** Presets first, then the library's own theme files; a file can't take a preset's id. */
export const availableThemes = (): readonly ThemeManifest[] => [
  ...THEME_PRESETS,
  ...customThemes.filter((theme) => !THEME_PRESETS.some((preset) => preset.id === theme.id)),
];

export const findTheme = (id: string) => availableThemes().find((theme) => theme.id === id);

const cache = (key: string, css: string) => {
  try {
    if (css) localStorage.setItem(key, css);
    else localStorage.removeItem(key);
  } catch {
    // The sheet still applies now; the next start just paints the defaults first.
  }
};

const styleElement = (id: string) => {
  let element = document.getElementById(id);
  if (!(element instanceof HTMLStyleElement)) {
    element?.remove();
    element = document.createElement("style");
    element.id = id;
  }
  return element as HTMLStyleElement;
};

/**
 * Puts both sheets last in the head, so a snippet outranks the app's own rules of equal
 * specificity. Stylesheets loaded later (lazy panels) would land after them, so this runs again
 * whenever the head gains one.
 */
const placeSheets = () => {
  const theme = styleElement(THEME_STYLE_ID);
  const snippets = styleElement(SNIPPETS_STYLE_ID);
  if (document.head.lastElementChild !== snippets || snippets.previousElementSibling !== theme) {
    document.head.append(theme, snippets);
  }
  return { theme, snippets };
};

let watchingHead = false;
const keepSheetsLast = () => {
  if (watchingHead || typeof MutationObserver === "undefined") return;
  watchingHead = true;
  new MutationObserver(() => placeSheets()).observe(document.head, { childList: true });
};

/** Lays the saved appearance over the default tokens and tells the window's listeners. */
export const applyAppearance = (appearance: Appearance = readAppearance()) => {
  const theme = findTheme(appearance.themeId);
  // A theme file not read yet keeps the sheet theme-init.js laid down from last session.
  const css =
    !theme && !customThemesLoaded
      ? readCache(THEME_CSS_KEY)
      : compileThemeCss(theme ?? findTheme(DEFAULT_THEME_ID) ?? null, appearance);
  const sheets = placeSheets();
  if (sheets.theme.textContent !== css) sheets.theme.textContent = css;
  if (sheets.snippets.textContent !== snippetsCss) sheets.snippets.textContent = snippetsCss;
  cache(THEME_CSS_KEY, css);
  cache(SNIPPETS_CSS_KEY, snippetsCss);
  keepSheetsLast();
  window.dispatchEvent(new Event("theme-change"));
  window.dispatchEvent(new Event("appearance-change"));
};

const saveAppearance = (appearance: Appearance) => {
  writePreference(APPEARANCE_KEY, appearance);
  applyAppearance(appearance);
};

export const updateAppearance = (change: Partial<Appearance>) =>
  saveAppearance({ ...readAppearance(), ...change });

/** The library's theme files changed; a removed one falls back to Loam without being forgotten. */
export const setCustomThemes = (themes: readonly ThemeManifest[]) => {
  customThemes = themes;
  customThemesLoaded = true;
  applyAppearance();
};

export const setSnippetsCss = (css: string) => {
  snippetsCss = css;
  applyAppearance();
};

export const subscribeToAppearance = (callback: () => void) => {
  window.addEventListener("appearance-change", callback);
  return () => window.removeEventListener("appearance-change", callback);
};
