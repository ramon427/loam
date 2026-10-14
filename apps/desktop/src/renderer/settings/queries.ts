import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { callBridge, onBridgeEvent } from "../bridge";

/** Keys of the queries several screens share, so a change made in one reaches the others. */
export const QUERY_KEYS = {
  aiChatStatus: ["ai-chat-status"],
  appInfo: ["app-info"],
  backups: ["backups"],
  securityStatus: ["security-status"],
  syncStatus: ["sync-status"],
  updateStatus: ["update-status"],
};

/** Puts each status the main process pushes as `event` into the query at `queryKey`. */
function useStatusEvents(
  event: "ai.status" | "security.status" | "sync.status" | "updates.status",
  queryKey: string[],
) {
  const queryClient = useQueryClient();
  useEffect(
    () => onBridgeEvent(event, (status) => queryClient.setQueryData(queryKey, status)),
    [event, queryKey, queryClient],
  );
}

/** The side chat's settings and providers; the main process reports every change. */
export function useAiChatStatus() {
  useStatusEvents("ai.status", QUERY_KEYS.aiChatStatus);
  return useQuery({
    queryKey: QUERY_KEYS.aiChatStatus,
    queryFn: () => callBridge("ai.status", {}),
    staleTime: Infinity,
  });
}

export const useAppInfo = () =>
  useQuery({ queryKey: QUERY_KEYS.appInfo, queryFn: () => callBridge("app.info", {}) });

export const useBackups = () =>
  useQuery({ queryKey: QUERY_KEYS.backups, queryFn: () => callBridge("backups.list", {}) });

/** Whether notes are encrypted; the main process reports every change. */
export function useSecurityStatus() {
  useStatusEvents("security.status", QUERY_KEYS.securityStatus);
  return useQuery({
    queryKey: QUERY_KEYS.securityStatus,
    queryFn: () => callBridge("security.status", {}),
    staleTime: Infinity,
  });
}

export function useSyncStatus() {
  useStatusEvents("sync.status", QUERY_KEYS.syncStatus);
  return useQuery({
    queryKey: QUERY_KEYS.syncStatus,
    queryFn: () => callBridge("sync.status", {}),
  });
}

/** Where app updates stand; the main process reports every change. */
export function useUpdateStatus() {
  useStatusEvents("updates.status", QUERY_KEYS.updateStatus);
  return useQuery({
    queryKey: QUERY_KEYS.updateStatus,
    queryFn: () => callBridge("updates.status", {}),
    staleTime: Infinity,
  });
}
