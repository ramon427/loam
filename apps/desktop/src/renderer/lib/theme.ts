export type AppTheme = "light" | "dark";

/** Saved by name, so public/theme-init.js can apply it before the first paint. */
const SAVED_THEME_KEY = "theme";

const systemPrefersLight = () => window.matchMedia("(prefers-color-scheme: light)");

const readSavedTheme = (): AppTheme | null => {
  try {
    const saved = localStorage.getItem(SAVED_THEME_KEY);
    return saved === "light" || saved === "dark" ? saved : null;
  } catch {
    return null;
  }
};

/** The theme the window shows: the saved one, else the system's. */
export const resolveTheme = (): AppTheme => {
  const shown = document.documentElement.dataset.theme;
  if (shown === "light" || shown === "dark") return shown;
  return readSavedTheme() ?? (systemPrefersLight().matches ? "light" : "dark");
};

/** Shows a theme the way theme-init.js does, and tells listeners. */
const showTheme = (theme: AppTheme) => {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  root.classList.toggle("dark", theme === "dark");
  window.dispatchEvent(new Event("theme-change"));
};

/** Saves and shows a chosen theme; the window stops following the system's. */
const chooseTheme = (theme: AppTheme) => {
  try {
    localStorage.setItem(SAVED_THEME_KEY, theme);
  } catch {
    // Storage can be unavailable; the theme still shows until the window closes.
  }
  showTheme(theme);
};

/** Light, dark, or whichever the system shows: what the Appearance settings offer. */
export type ThemeChoice = AppTheme | "system";

export const readThemeChoice = (): ThemeChoice => readSavedTheme() ?? "system";

/** Saves a choice; "system" forgets the saved theme so the window follows the system's again. */
export const chooseThemeChoice = (choice: ThemeChoice) => {
  if (choice !== "system") {
    chooseTheme(choice);
    return;
  }
  try {
    localStorage.removeItem(SAVED_THEME_KEY);
  } catch {
    // Storage can be unavailable; the system's theme still shows until the window closes.
  }
  showTheme(systemPrefersLight().matches ? "light" : "dark");
};

/** Until a theme is saved, the window follows the system's light or dark setting as it changes. */
export const followSystemTheme = () => {
  const system = systemPrefersLight();
  const follow = () => {
    if (!readSavedTheme()) showTheme(system.matches ? "light" : "dark");
  };
  system.addEventListener("change", follow);
  return () => system.removeEventListener("change", follow);
};

export const subscribeToThemeChanges = (callback: (theme: AppTheme) => void) => {
  const handler = () => callback(resolveTheme());
  window.addEventListener("theme-change", handler);
  return () => window.removeEventListener("theme-change", handler);
};
