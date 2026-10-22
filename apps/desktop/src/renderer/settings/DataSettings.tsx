import { useMutation } from "@tanstack/react-query";
import { FolderOpenIcon } from "lucide-react";

import { callBridge } from "../bridge";
import { errorMessage } from "@loam/notes-ui/lib/errorMessage";
import { Button } from "@loam/notes-ui/ui/Button";
import { toastError } from "@loam/notes-ui/ui/toast";

import { useAppInfo } from "./queries";
import {
  SettingsDetails,
  SettingsNote,
  SettingsNotice,
  SettingsRow,
  SettingsSection,
} from "./SettingsLayout";
import styles from "./settings.module.css";

/** Where notes live and which storage backend holds them. */
export function DataSettings() {
  const info = useAppInfo();
  const openFolder = useMutation({
    mutationFn: () => callBridge("app.openDataDirectory", {}),
    onError: (error) =>
      toastError("Could not open the data folder", { description: errorMessage(error) }),
  });

  return (
    <SettingsSection description="Your notes live on this computer. Open their folder below.">
      {info.isError ? (
        <SettingsNotice tone="danger">
          Could not read the app details. Close and reopen Loam.
        </SettingsNotice>
      ) : null}
      <SettingsRow
        title="Data folder"
        description={
          <code className={styles.path} data-testid="settings-data-folder">
            {info.data?.dataDirectory ?? "…"}
          </code>
        }
        control={
          <Button
            variant="outline"
            size="sm"
            disabled={!info.data || openFolder.isPending}
            onClick={() => openFolder.mutate()}
          >
            <FolderOpenIcon className="size-4" aria-hidden="true" />
            Open data folder
          </Button>
        }
      />
      <SettingsDetails label="Storage details">
        <SettingsRow
          title="Storage"
          description={
            <span data-testid="settings-storage-adapter">{info.data?.storageAdapter ?? "…"}</span>
          }
        />
        <SettingsNote>If you enable sync, a copy also lives in your sync folder.</SettingsNote>
      </SettingsDetails>
    </SettingsSection>
  );
}
