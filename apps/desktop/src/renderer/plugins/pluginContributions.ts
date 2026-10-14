/*
 * What plugins added to the window: commands, slash menu items and open panes. Each change
 * calls `changed`, so the window draws what plugins added again.
 */

export type PluginCommand = {
  pluginId: string;
  /** `plugin:<plugin id>.<command id>`, unique across plugins. */
  id: string;
  title: string;
  key?: string;
};

export type PluginSlashItem = {
  pluginId: string;
  id: string;
  title: string;
  subtext?: string;
  aliases: string[];
};

export type PluginPane = { pluginId: string; id: string; title: string };

export const createPluginContributions = (changed: () => void) => {
  let commands: PluginCommand[] = [];
  let slashItems: PluginSlashItem[] = [];
  let panes: PluginPane[] = [];

  return {
    get commands(): readonly PluginCommand[] {
      return commands;
    },
    get slashItems(): readonly PluginSlashItem[] {
      return slashItems;
    },
    get panes(): readonly PluginPane[] {
      return panes;
    },

    /** Adds a command, replacing one with the same id. */
    registerCommand(command: PluginCommand) {
      commands = [...commands.filter((existing) => existing.id !== command.id), command];
      changed();
    },

    /** Adds a slash menu item, replacing the plugin's item with the same id. */
    registerSlashItem(item: PluginSlashItem) {
      slashItems = [
        ...slashItems.filter(
          (existing) => !(existing.pluginId === item.pluginId && existing.id === item.id),
        ),
        item,
      ];
      changed();
    },

    /** Opens a pane, or brings the plugin's pane with the same id to the end. */
    openPane(pane: PluginPane) {
      panes = [
        ...panes.filter((open) => !(open.pluginId === pane.pluginId && open.id === pane.id)),
        pane,
      ];
      changed();
    },

    closePane(pluginId: string, id: string) {
      panes = panes.filter((open) => !(open.pluginId === pluginId && open.id === id));
      changed();
    },

    /** Drops everything a stopped plugin added; the caller says when that is drawn. */
    forget(pluginId: string) {
      commands = commands.filter((command) => command.pluginId !== pluginId);
      slashItems = slashItems.filter((item) => item.pluginId !== pluginId);
      panes = panes.filter((pane) => pane.pluginId !== pluginId);
    },
  };
};

export type PluginContributions = ReturnType<typeof createPluginContributions>;
