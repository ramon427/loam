import type { ThemeManifest } from "@loam/shared/themes/themeSchema";

/** Loam's own colours: the tokens in styles/app.css, with nothing laid over them. */
export const DEFAULT_THEME_ID = "loam";

/** The themes that ship with the app, in the order the Appearance settings show them. */
export const THEME_PRESETS: readonly ThemeManifest[] = [
  { id: DEFAULT_THEME_ID, name: "Loam", author: "Loam", light: {}, dark: {} },
  {
    id: "nord",
    name: "Nord",
    author: "Arctic Ice Studio",
    light: {
      palette: {
        background: "#eceff4",
        surface: "#f8f9fb",
        text: "#2e3440",
        muted: "#5e6779",
        border: "#d8dee9",
        accent: "#5e81ac",
        success: "#4c7a3f",
        warning: "#b8741a",
        danger: "#bf616a",
        info: "#5e81ac",
      },
    },
    dark: {
      palette: {
        background: "#2e3440",
        surface: "#3b4252",
        text: "#eceff4",
        muted: "#9aa3b5",
        border: "#434c5e",
        accent: "#88c0d0",
        success: "#a3be8c",
        warning: "#ebcb8b",
        danger: "#bf616a",
        info: "#81a1c1",
      },
    },
  },
  {
    id: "solarized",
    name: "Solarized",
    author: "Ethan Schoonover",
    light: {
      palette: {
        background: "#fdf6e3",
        surface: "#fffbf0",
        text: "#073642",
        muted: "#657b83",
        border: "#eee8d5",
        accent: "#268bd2",
        success: "#859900",
        warning: "#b58900",
        danger: "#dc322f",
        info: "#2aa198",
      },
    },
    dark: {
      palette: {
        background: "#002b36",
        surface: "#073642",
        text: "#eee8d5",
        muted: "#839496",
        border: "#0d4a58",
        accent: "#2aa198",
        success: "#859900",
        warning: "#b58900",
        danger: "#dc322f",
        info: "#268bd2",
      },
    },
  },
  {
    id: "catppuccin",
    name: "Catppuccin",
    author: "Catppuccin",
    light: {
      palette: {
        background: "#eff1f5",
        surface: "#ffffff",
        text: "#4c4f69",
        muted: "#6c6f85",
        border: "#ccd0da",
        accent: "#8839ef",
        success: "#40a02b",
        warning: "#df8e1d",
        danger: "#d20f39",
        info: "#1e66f5",
      },
    },
    dark: {
      palette: {
        background: "#1e1e2e",
        surface: "#232336",
        text: "#cdd6f4",
        muted: "#9399b2",
        border: "#313244",
        accent: "#cba6f7",
        success: "#a6e3a1",
        warning: "#f9e2af",
        danger: "#f38ba8",
        info: "#89b4fa",
      },
    },
  },
  {
    id: "rose-pine",
    name: "Rosé Pine",
    author: "Rosé Pine",
    light: {
      palette: {
        background: "#faf4ed",
        surface: "#fffaf3",
        text: "#575279",
        muted: "#797593",
        border: "#dfdad9",
        accent: "#907aa9",
        success: "#286983",
        warning: "#ea9d34",
        danger: "#b4637a",
        info: "#56949f",
      },
    },
    dark: {
      palette: {
        background: "#191724",
        surface: "#1f1d2e",
        text: "#e0def4",
        muted: "#908caa",
        border: "#26233a",
        accent: "#c4a7e7",
        success: "#9ccfd8",
        warning: "#f6c177",
        danger: "#eb6f92",
        info: "#31748f",
      },
    },
  },
  {
    id: "paper",
    name: "Paper",
    author: "Loam",
    light: {
      palette: {
        background: "#f4efe6",
        surface: "#fbf8f2",
        text: "#2b2620",
        muted: "#6f665a",
        border: "#e2d9ca",
        accent: "#9a4f2b",
      },
    },
  },
];
