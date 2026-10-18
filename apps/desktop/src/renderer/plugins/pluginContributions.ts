/*
 * What plugins added to the window: commands, slash menu items, open panes and the questions
 * they asked. Each change
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

/** `side`: a pane at the window's right edge; `main`: a view over the whole note area. */
export type PluginPane = { pluginId: string; id: string; title: string; place: "side" | "main" };

/**
 * A question a plugin asked: a line of text (`$.ui.prompt`) or one of a few choices
 * (`$.ui.choose`). Answered once, with null if dismissed.
 */
export type PluginPrompt = {
  pluginId: string;
  id: number;
  title: string;
  placeholder?: string;
  value?: string;
  description?: string;
  choices?: { value: string; label: string; tone?: "danger" }[];
  answer: (value: string | null) => void;
};

export const createPluginContributions = (changed: () => void) => {
  let commands: PluginCommand[] = [];
  let slashItems: PluginSlashItem[] = [];
  let panes: PluginPane[] = [];
  let prompts: PluginPrompt[] = [];
  let promptCount = 0;

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
    /** The question shown now; the others wait their turn. */
    get prompt(): PluginPrompt | null {
      return prompts[0] ?? null;
    },

    /** Asks for a line of text, resolving with it, or with null when the dialog is dismissed. */
    ask(prompt: Omit<PluginPrompt, "id" | "answer" | "choices" | "description">) {
      return this.question(prompt);
    },

    /** Offers a few choices, resolving with the value picked, or null when dismissed. */
    choose(
      prompt: Required<Pick<PluginPrompt, "pluginId" | "title" | "choices">> & {
        description?: string;
      },
    ) {
      return this.question(prompt);
    },

    question(prompt: Omit<PluginPrompt, "id" | "answer">) {
      return new Promise<string | null>((resolve) => {
        const id = (promptCount += 1);
        prompts = [
          ...prompts,
          {
            ...prompt,
            id,
            answer: (value) => {
              prompts = prompts.filter((open) => open.id !== id);
              resolve(value);
              changed();
            },
          },
        ];
        changed();
      });
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

    /**
     * Opens a pane, or brings the plugin's pane with the same id to the end. One view shows
     * over the notes at a time, so a new one replaces the one before.
     */
    openPane(pane: PluginPane) {
      panes = [
        ...panes.filter(
          (open) =>
            !(open.pluginId === pane.pluginId && open.id === pane.id) &&
            !(pane.place === "main" && open.place === "main"),
        ),
        pane,
      ];
      changed();
    },

    /** Closes the view over the notes, as opening a note does. */
    closeViews() {
      if (!panes.some((pane) => pane.place === "main")) return;
      panes = panes.filter((pane) => pane.place !== "main");
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
      const asked = prompts.filter((prompt) => prompt.pluginId === pluginId);
      prompts = prompts.filter((prompt) => prompt.pluginId !== pluginId);
      for (const prompt of asked) prompt.answer(null);
    },
  };
};

export type PluginContributions = ReturnType<typeof createPluginContributions>;
