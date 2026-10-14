import { useMutation, useQueryClient } from "@tanstack/react-query";

import { callBridge } from "../bridge";
import { errorMessage } from "../lib/errorMessage";
import { QUERY_KEYS } from "../settings/queries";
import { toastError } from "../ui/toast";

/** Looks for an update now; a found one downloads in the background. */
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
