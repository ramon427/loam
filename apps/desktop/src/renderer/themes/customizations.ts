import type { BridgeCustomizations } from "@loam/shared/bridge/loamBridge";
import { compileSnippetsCss } from "@loam/shared/themes/snippetCss";

import { callBridge, onBridgeEvent } from "../bridge";
import { readPreference, writePreference } from "../lib/preferences";

import { setCustomThemes, setSnippetsCss } from "./appearance";

/*
 * The library's theme files and CSS snippets, read from the main process and kept current as
 * the files change. Snippets are off until switched on, by file name.
 */

const ENABLED_SNIPPETS_KEY = "snippets";

const readNames = (value: unknown) =>
  Array.isArray(value) && value.every((name) => typeof name === "string")
    ? (value as string[])
    : null;

let current: BridgeCustomizations | null = null;
let loadError: string | null = null;
let enabledSnippets: readonly string[] = readPreference(ENABLED_SNIPPETS_KEY, readNames) ?? [];
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) listener();
};

const apply = () => {
  if (!current) return;
  setCustomThemes(current.themes.flatMap((entry) => (entry.ok ? [entry.theme] : [])));
  setSnippetsCss(
    compileSnippetsCss(
      current.snippets.filter((snippet) => enabledSnippets.includes(snippet.file)),
    ),
  );
};

export const reloadCustomizations = async () => {
  try {
    current = await callBridge("customizations.list", {});
    loadError = null;
  } catch {
    loadError = "The theme and snippet files could not be read.";
  }
  apply();
  notify();
};

/** Reads the files now and again whenever they change. */
export const installCustomizations = () => {
  void reloadCustomizations();
  return onBridgeEvent("customizations.changed", () => void reloadCustomizations());
};

export const setSnippetEnabled = (file: string, enabled: boolean) => {
  enabledSnippets = enabled
    ? [...enabledSnippets.filter((name) => name !== file), file]
    : enabledSnippets.filter((name) => name !== file);
  writePreference(ENABLED_SNIPPETS_KEY, enabledSnippets);
  apply();
  notify();
};

interface CustomizationsSnapshot {
  files: BridgeCustomizations | null;
  error: string | null;
  enabledSnippets: readonly string[];
}

let snapshot: CustomizationsSnapshot = { files: null, error: null, enabledSnippets };

export const readCustomizations = () => {
  if (
    snapshot.files !== current ||
    snapshot.error !== loadError ||
    snapshot.enabledSnippets !== enabledSnippets
  ) {
    snapshot = { files: current, error: loadError, enabledSnippets };
  }
  return snapshot;
};

export const subscribeToCustomizations = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
