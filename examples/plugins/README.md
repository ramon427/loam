# Example plugins

Three small plugins that show the plugin API (types in `packages/plugin-api/index.d.ts`):

- **word-count**: draws the open note's word count into the note header (`notes:read`).
- **daily-note**: a palette command with a shortcut that opens or makes today's note, and a slash
  menu item that inserts the date (`notes:read`, `notes:write`, a setting).
- **focus-timer**: a sidebar button that opens a pane with a timer, kept in `$.state` (`ui`).

Build them with `node examples/plugins/build.mjs`, then copy a plugin's folder (its
`manifest.json` and the built `main.js`) into the `plugins` folder of Loam's data folder: in the
app, Settings → Plugins → Open folder. Turn off restricted mode and switch the plugin on.

## How a plugin works

```tsx
import type { Register } from "@loam/plugin-api";

export const register: Register = (on, options) => {
  on("app.ready", async ($) => {
    await $.commands.register({ id: "hello", title: "Say hello", key: "Mod+Shift+H" });
  });
  on("command.run", { command: "hello" }, async ($) => {
    await $.ui.toast("Hello!");
  });
  on("ui.render", { slot: "note.header" }, async ($, e) => <Text tone="muted">Hi</Text>);
};
```

- `on(event, matcher?, hook)` adds a hook. Every hook is `($, e, next)`: `$` is the plugin's
  only way out of its worker, `e` the event's input, and `next(e)` runs the hooks after it and
  then the app's own behaviour. Return without calling `next` to answer for yourself (a
  `note.open` hook returning `{ deny: "why" }` keeps the note closed).
- A plugin runs in a worker of its own: no DOM, no Node, and no network but `$.net.fetch` to
  hosts its manifest names (`network:api.example.com`). Each `$` call is checked against the
  permissions the user granted when switching the plugin on.
- Drawings are plain element trees (`Box`, `Text`, `Heading`, `Badge`, `Button`, `Input`,
  `Checkbox`, `Select`, `Link`, `Divider`, `Icon`) the window maps onto its own components, so plugins
  follow the theme. Functions in props stay in the worker; the window sends presses back.
- Slots: `note.header`, `sidebar.footer`, and `pane` for panes opened with `$.ui.open`.
- The plugins that ship with Loam, in `apps/desktop/plugins`, are larger examples: a Google
  Calendar pane read from an iCal feed, and a todo list kept in `$.store`.
- Plugin files reload as you save them.
