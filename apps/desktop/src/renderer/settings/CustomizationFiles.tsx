import { useSyncExternalStore } from "react";
import { FolderOpenIcon, RefreshCwIcon } from "lucide-react";

import type { BridgeCustomizationKind } from "@loam/shared/bridge/loamBridge";

import { callBridge } from "../bridge";
import {
  readCustomizations,
  reloadCustomizations,
  setSnippetEnabled,
  subscribeToCustomizations,
} from "../themes/customizations";
import { Button } from "@loam/notes-ui/ui/Button";
import { Checkbox } from "@loam/notes-ui/ui/Checkbox";
import { toastError } from "@loam/notes-ui/ui/toast";

import { SettingsNote, SettingsNotice, SettingsRow, SettingsSection } from "./SettingsLayout";

const reveal = (kind: BridgeCustomizationKind) =>
  callBridge("customizations.reveal", { kind }).catch(() =>
    toastError("The folder could not be opened."),
  );

function FolderButtons({ kind }: { kind: BridgeCustomizationKind }) {
  return (
    <div className="flex gap-1.5">
      <Button variant="outline" size="sm" onClick={() => void reloadCustomizations()}>
        <RefreshCwIcon className="size-3.5" aria-hidden />
        Reload
      </Button>
      <Button variant="outline" size="sm" onClick={() => void reveal(kind)}>
        <FolderOpenIcon className="size-3.5" aria-hidden />
        Open folder
      </Button>
    </div>
  );
}

/** The theme files and CSS snippets kept in the data folder. */
export function CustomizationFiles() {
  const { files, error, enabledSnippets } = useSyncExternalStore(
    subscribeToCustomizations,
    readCustomizations,
  );
  const brokenThemes = files?.themes.filter((entry) => !entry.ok) ?? [];
  const themeCount = files ? files.themes.length - brokenThemes.length : 0;

  return (
    <>
      <SettingsSection
        title="Theme files"
        description="Themes of your own, as JSON files in the data folder's themes folder. They appear with the themes above, and change as you save them."
      >
        {error ? <SettingsNotice tone="danger">{error}</SettingsNotice> : null}
        <SettingsRow
          title="Themes folder"
          description={files ? (themeCount === 1 ? "1 theme" : `${themeCount} themes`) : "Reading…"}
          control={<FolderButtons kind="themes" />}
        />
        {brokenThemes.map((entry) => (
          <SettingsRow
            key={entry.file}
            title={entry.file}
            description={
              <span className="text-(--status-danger)">{entry.ok ? "" : entry.error}</span>
            }
          />
        ))}
        <SettingsNote>
          A theme file gives a palette of base colours, token overrides, or both, for light and/or
          dark: {'{ "id": "dusk", "name": "Dusk", "dark": { "palette": { "background": "#1b1b24", '}
          {'"surface": "#22222e", "text": "#e6e6f0", "muted": "#9090a8", "border": "#30303e", '}
          {'"accent": "#f0a060" } } }'}
        </SettingsNote>
      </SettingsSection>
      <SettingsSection
        title="CSS snippets"
        description="Stylesheets of your own, laid over the app's, for changes a theme can't make. Each is off until you switch it on."
      >
        <SettingsRow title="Snippets folder" control={<FolderButtons kind="snippets" />} />
        {files?.snippets.length === 0 ? (
          <SettingsNote>No snippets yet. Add a .css file to the snippets folder.</SettingsNote>
        ) : null}
        {files?.snippets.map((snippet) => (
          <SettingsRow
            key={snippet.file}
            title={snippet.file}
            control={
              <Checkbox
                aria-label={`Use ${snippet.file}`}
                checked={enabledSnippets.includes(snippet.file)}
                onCheckedChange={(checked) => setSnippetEnabled(snippet.file, checked === true)}
              />
            }
          />
        ))}
        <SettingsNote>
          Snippets can't load anything from the internet: imports and addresses other than data:
          ones are removed.
        </SettingsNote>
      </SettingsSection>
    </>
  );
}
