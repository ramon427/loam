import { z } from "zod";

import { THEME_TOKEN_NAMES, type ThemeTokenName } from "./themeTokens";

/*
 * A theme as a file holds it. Values become CSS custom properties, so they are held to the
 * characters a colour needs: no quotes, semicolons, braces, at-rules or url(), which keeps a
 * theme from loading anything or escaping its declaration.
 */

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const CSS_COLOR = /^[#a-z0-9(),.%\s/-]+$/i;

export const isHexColor = (value: string) => HEX_COLOR.test(value);

/** A colour value: hex, rgb(), hsl(), oklch(), color-mix() or a named colour. */
const isSafeCssColor = (value: string) =>
  value.length <= 160 && CSS_COLOR.test(value) && !/url|expression|image/i.test(value);

/** A font-family list: names, quotes, commas and hyphens only. */
export const isSafeFontFamily = (value: string) =>
  value.length <= 300 && /^[a-z0-9\s,"'_-]+$/i.test(value);

const hexColor = z.string().refine(isHexColor, "Expected a hex colour such as #1e1e2e");
const cssColor = z.string().refine(isSafeCssColor, "Expected a CSS colour");

/** The few base colours a theme can give instead of every token; the rest derive from them. */
const themePaletteSchema = z.object({
  background: hexColor,
  surface: hexColor,
  text: hexColor,
  muted: hexColor,
  border: hexColor,
  accent: hexColor,
  accentText: hexColor.optional(),
  success: hexColor.optional(),
  warning: hexColor.optional(),
  danger: hexColor.optional(),
  info: hexColor.optional(),
});

export type ThemePalette = z.infer<typeof themePaletteSchema>;

export type ThemeTokens = Partial<Record<ThemeTokenName, string>>;

const themeTokensSchema = z.partialRecord(
  z.enum(THEME_TOKEN_NAMES as [ThemeTokenName, ...ThemeTokenName[]]),
  cssColor,
) satisfies z.ZodType<ThemeTokens>;

/** One mode of a theme: a palette, token overrides on top of it, or both. */
const themeModeSchema = z.object({
  palette: themePaletteSchema.optional(),
  tokens: themeTokensSchema.optional(),
});

export type ThemeMode = z.infer<typeof themeModeSchema>;

export const themeManifestSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "Use lowercase letters, digits and hyphens"),
    name: z.string().min(1).max(80),
    author: z.string().max(80).optional(),
    version: z.string().max(32).optional(),
    light: themeModeSchema.optional(),
    dark: themeModeSchema.optional(),
  })
  .refine((theme) => theme.light || theme.dark, "A theme needs a light or a dark mode");

export type ThemeManifest = z.infer<typeof themeManifestSchema>;

export type ThemeAppearance = "light" | "dark";

export const themeModes = (theme: ThemeManifest): ThemeAppearance[] =>
  (["light", "dark"] as const).filter((mode) => theme[mode]);
