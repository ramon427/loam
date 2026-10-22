import { useEffect, useId, useState, useSyncExternalStore } from "react";

import { stableJsonStringify } from "@loam/shared/utils/stableJson";

import { cn } from "@loam/notes-ui/ui/cn";

import { PluginElement } from "./PluginElement";
import { handlerIds, validateTree } from "./pluginElementTree";
import { pluginHost } from "./host";
import { isHandlerRef, type PluginNode } from "./protocol";

/** Re-renders when anything a plugin added or drew may have changed. */
export const usePluginHost = () => useSyncExternalStore(pluginHost.subscribe, pluginHost.snapshot);

/**
 * One plugin's part of a slot. It draws again when its props change or its plugin's state
 * does; another plugin's changes leave it alone.
 */
function PluginPart({
  pluginId,
  name,
  propsKey,
}: {
  pluginId: string;
  name: string;
  propsKey: string;
}) {
  const drawVersion = usePluginHost().drawVersions[pluginId] ?? 0;
  const requestId = `${name}:${useId()}:${pluginId}`;
  const [tree, setTree] = useState<PluginNode | null>(null);

  useEffect(() => {
    let current = true;
    void pluginHost
      .renderPart(name, requestId, JSON.parse(propsKey) as Record<string, unknown>, pluginId)
      .then((drawn) => {
        if (!current) return;
        if (drawn === null || drawn === undefined) {
          pluginHost.drew(requestId, null, []);
          setTree(null);
          return;
        }
        const reason = validateTree(drawn);
        if (reason) {
          pluginHost.log(pluginId, "error", `${name} drawing refused: ${reason}`);
          pluginHost.drew(requestId, null, []);
          setTree(null);
          return;
        }
        pluginHost.drew(requestId, pluginId, handlerIds(drawn));
        setTree(drawn as PluginNode);
      });
    return () => {
      current = false;
    };
  }, [pluginId, name, requestId, propsKey, drawVersion]);

  // The handlers of what it drew last are released when the part goes away.
  useEffect(() => () => pluginHost.drew(requestId, null, []), [requestId]);

  if (!tree) return null;
  return (
    <div className="contents" data-plugin={pluginId}>
      <PluginElement
        node={tree}
        press={(handler, payload) => {
          if (isHandlerRef(handler)) pluginHost.press(pluginId, handler.__handler, payload);
        }}
      />
    </div>
  );
}

/**
 * One place in the window plugins may draw into, such as the note header. Each plugin with a
 * `ui.render` hook draws its own part there; one whose tree doesn't validate draws nothing, and
 * the reason goes to its log in the Plugins settings.
 */
export function PluginSlot({
  name,
  props,
  only,
  className,
}: {
  name: string;
  props: Record<string, unknown>;
  /** Draws only this plugin's part, as a plugin's own pane does. */
  only?: string;
  className?: string;
}) {
  const { renderers } = usePluginHost();
  const pluginIds = only ? renderers.filter((pluginId) => pluginId === only) : renderers;
  const propsKey = stableJsonStringify(props);
  if (pluginIds.length === 0) return null;
  return (
    <div className={cn("flex min-w-0 items-center gap-1.5", className)} data-plugin-slot={name}>
      {pluginIds.map((pluginId) => (
        <PluginPart key={pluginId} pluginId={pluginId} name={name} propsKey={propsKey} />
      ))}
    </div>
  );
}
