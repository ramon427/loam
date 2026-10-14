import { contextBridge, ipcRenderer, webUtils } from "electron";

import {
  LOAM_BRIDGE_CHANNEL_PREFIX,
  LOAM_BRIDGE_EVENT_CHANNEL,
  LOAM_BRIDGE_EVENTS,
  LOAM_BRIDGE_METHODS,
  type LoamBridge,
} from "@loam/shared/bridge/loamBridge";

const allowedMethods = new Set<string>(LOAM_BRIDGE_METHODS);
const allowedEvents = new Set<string>(LOAM_BRIDGE_EVENTS);

// The renderer gets one function that can reach only the listed methods.
const bridge: LoamBridge = {
  invoke: ((method: string, params: unknown) => {
    if (!allowedMethods.has(method)) return Promise.reject(new Error("Unknown bridge method"));
    return ipcRenderer.invoke(`${LOAM_BRIDGE_CHANNEL_PREFIX}${method}`, params);
  }) as LoamBridge["invoke"],
  on: ((event: string, listener: (payload: unknown) => void) => {
    if (!allowedEvents.has(event)) throw new Error("Unknown bridge event");
    // The listener gets only the payload, never Electron's event object.
    const forward = (_event: unknown, name: unknown, payload: unknown) => {
      if (name === event) listener(payload);
    };
    ipcRenderer.on(LOAM_BRIDGE_EVENT_CHANNEL, forward);
    return () => void ipcRenderer.off(LOAM_BRIDGE_EVENT_CHANNEL, forward);
  }) as LoamBridge["on"],
  platform: process.platform,
  pathForFile: (file) => webUtils.getPathForFile(file),
};

contextBridge.exposeInMainWorld("loam", bridge);
