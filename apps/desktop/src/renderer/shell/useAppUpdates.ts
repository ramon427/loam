import { useMutation, useQueryClient } from "@tanstack/react-query";

import { callBridge } from "../bridge";
import { errorMessage } from "@loam/notes-ui/lib/errorMessage";
import { QUERY_KEYS } from "../settings/queries";
import { toastError } from "@loam/notes-ui/ui/toast";

export const RELEASES_URL = "https://github.com/ramon427/loam/releases";
export const releaseUrl = (version: string) =>
  `${RELEASES_URL}/tag/v${encodeURIComponent(version)}`;

/** Opens a version's release page in the browser, to download a copy that can't update itself. */
export const openReleasePage = (version: string | null) =>
  window.open(version ? releaseUrl(version) : RELEASES_URL, "_blank", "noopener");

/** Looks for an update now; a found one downloads in the background where the app can install it. */
export function useCheckForUpdates() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => callBridge("updates.check", {}),
    onSuccess: (next) => queryClient.setQueryData(QUERY_KEYS.updateStatus, next),
    onError: (error) =>
      toastError("Could not check for updates", { description: errorMessage(error) }),
  });
}

/** Restarts into the downloaded update; the window asks first if edits are still saving. */
export function useInstallUpdate() {
  return useMutation({
    mutationFn: () => callBridge("updates.install", {}),
    onError: (error) =>
      toastError("Could not restart to update", { description: errorMessage(error) }),
  });
}
